# Dynamic Printer Attributes — Design

**Date:** 2026-04-26
**Status:** Draft

---

## Overview

Add dynamic dropdowns for the `sides`, `media`, and `colorMode` (new) fields in the Print Job node. When a printer is selected, the node fetches printer-specific supported values via `Get-Printer-Attributes`. When no printer is selected, or if the fetch fails, static IPP General defaults are displayed silently.

---

## User Experience

### Printer not selected (or Get-Printer-Attributes fails silently)

A notice is displayed above the affected fields:

> ℹ Select a printer to load printer-specific options. Showing IPP General defaults.

Each field shows a list of standard IPP values labeled `(IPP General)`:

| Field | Options |
|-------|---------|
| Sides | One-Sided (IPP General), Two-Sided Long Edge (IPP General), Two-Sided Short Edge (IPP General) |
| Media | A4 (IPP General), US Letter (IPP General), A3 (IPP General), US Legal (IPP General) |
| Color Mode | Color (IPP General), Monochrome (IPP General), Auto (IPP General) |

All three fields also support manual text entry (`id` mode in `resourceLocator`).

### Printer selected and Get-Printer-Attributes succeeds

The notice is hidden. Each field shows the printer's supported values without any prefix. Manual text entry remains available.

---

## New Helper: `fetchPrinterAttributes`

```typescript
export interface PrinterAttributes {
  sidesSupported: string[];
  mediaSupported: string[];
  colorModesSupported: string[];
}

export async function fetchPrinterAttributes(
  host: string,
  port: number,
  printerName: string,
  username: string,
  printerFactory?: IppPrinterFactory,
): Promise<PrinterAttributes | null>
```

- Sends `Get-Printer-Attributes` to `http://{host}:{port}/printers/{printerName}`
- Requested attributes: `sides-supported`, `media-supported`, `print-color-mode-supported`
- Returns `null` on any network or IPP error (caller falls back silently to static defaults)
- Uses the same `IppPrinterFactory` injection pattern as `fetchCupsPrinters`

---

## Field Changes

### `sides` — `options` → `resourceLocator`

```typescript
{
  displayName: "Sides",
  name: "sides",
  type: "resourceLocator",
  default: { mode: "list", value: "one-sided" },
  modes: [
    {
      displayName: "From List",
      name: "list",
      type: "list",
      typeOptions: { searchListMethod: "getSidesOptions", searchable: false },
    },
    {
      displayName: "By Value",
      name: "id",
      type: "string",
      placeholder: "one-sided",
    },
  ],
}
```

`execute` reads with `{ extractValue: true }`.

### `media` — `string` → `resourceLocator`

Same structure. `searchListMethod: "getMediaOptions"`, placeholder `iso_a4_210x297mm`, default `{ mode: "list", value: "iso_a4_210x297mm" }`.

`execute` reads with `{ extractValue: true }`.

### `colorMode` — new `resourceLocator`

Inserted after `media`, before Advanced Options. `searchListMethod: "getColorModeOptions"`, placeholder `color`, default `{ mode: "list", value: "color" }`. Sent as `print-color-mode` in `job-attributes-tag`.

### Notice field

```typescript
{
  displayName: "",
  name: "printerAttributesNotice",
  type: "notice",
  default: "",
  displayOptions: {
    show: { "printerName": [""] },
  },
  description:
    "Select a printer to load printer-specific options. Showing IPP General defaults.",
}
```

Shown immediately above `sides`.

> **Implementation note:** `displayOptions` conditions on `resourceLocator` fields compare against the raw stored object, not the extracted string value. Verify during implementation that `{ show: { "printerName": [""] } }` triggers correctly; if not, an alternative approach (e.g., always show the notice and rely on list loading behavior) should be used.

---

## New `listSearch` Methods

All three methods follow the same pattern:

1. Read `printerName` via `getCurrentNodeParameter("printerName", { extractValue: true })`
2. If empty → return static `(IPP General)` defaults
3. If set → call `fetchPrinterAttributes(host, port, printerName, username, printerFactory)`
4. On success → return printer-specific values (no prefix)
5. On error → return static `(IPP General)` defaults silently
6. Apply `filter` (case-insensitive substring) if provided

```
getSidesOptions(filter?)      reads sides-supported
getMediaOptions(filter?)      reads media-supported
getColorModeOptions(filter?)  reads print-color-mode-supported
```

`printerFactory` is captured via the constructor closure (same DI pattern as `getCupsPrinters`).

---

## `execute` Changes

```typescript
const sides = this.getNodeParameter("sides", i, undefined, { extractValue: true }) as string;
const media = this.getNodeParameter("media", i, undefined, { extractValue: true }) as string;
const colorMode = this.getNodeParameter("colorMode", i, undefined, { extractValue: true }) as string;

// job-attributes-tag
{
  copies,
  sides,
  media,
  "print-color-mode": colorMode,
}
```

Output `json` gains a `"print-color-mode"` field alongside existing job attributes.

---

## IPP Message Structure (updated)

```
operation-attributes-tag:
  requesting-user-name  ← credential.username
  job-name              ← Advanced Options > Job Name
  document-format       ← Advanced Options > Document Format

job-attributes-tag:
  copies                ← Copies
  sides                 ← Sides (extracted from resourceLocator)
  media                 ← Media (extracted from resourceLocator)
  print-color-mode      ← Color Mode (new)

data                    ← binary buffer from Binary Property
```

---

## Static Defaults Reference

### Sides

| Display name | IPP value |
|---|---|
| One-Sided (IPP General) | `one-sided` |
| Two-Sided Long Edge (IPP General) | `two-sided-long-edge` |
| Two-Sided Short Edge (IPP General) | `two-sided-short-edge` |

### Media

| Display name | IPP value |
|---|---|
| A4 (IPP General) | `iso_a4_210x297mm` |
| US Letter (IPP General) | `na_letter_8.5x11in` |
| A3 (IPP General) | `iso_a3_297x420mm` |
| US Legal (IPP General) | `na_legal_8.5x14in` |

### Color Mode

| Display name | IPP value |
|---|---|
| Color (IPP General) | `color` |
| Monochrome (IPP General) | `monochrome` |
| Auto (IPP General) | `auto` |

---

## Testing

- `fetchPrinterAttributes`: unit tests with mock factory (success, null on error, partial attributes)
- `getSidesOptions` / `getMediaOptions` / `getColorModeOptions`: tests for empty printerName (returns IPP General defaults), set printerName with successful fetch (returns printer values), set printerName with fetch failure (falls back to IPP General defaults), filter argument
- `execute`: test that `print-color-mode` is included in IPP message and output JSON

---

## Out of Scope

- `sides-default`, `media-default`, `print-color-mode-default` (using printer defaults as the pre-selected value in the UI)
- Pagination of large `media-supported` lists
- TLS/IPPS support
