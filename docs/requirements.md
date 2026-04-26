# Requirements

This document reflects the current confirmed specification.
It is updated incrementally as draft stories are completed and merged.

---

## Package

| Item | Value |
|------|-------|
| Package name | `@a24k/n8n-nodes-printipp` |
| Display name | `PrintIPP @a24k` |
| npm keyword | `n8n-community-node-package` |
| Target n8n version | 1.x and above |
| Runtime dependencies | `ipp` ^2.0.1 (pure-JS IPP implementation, no system deps) |

> **Note on Verified eligibility:** The `ipp` runtime dependency disqualifies this package from npm
> Verified node status. The dependency is intentional — it replaces the system-level `lp`/`lpr`
> command and enables IPP printing from any n8n deployment (Docker, cloud, etc.) without printer
> driver installation.

---

## Credential: `printIpp`

Defined in `src/credentials/PrintIpp.credentials.ts`. Display name: **PrintIPP Endpoint**.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| Connection Type | `options` | — | `cups` | Server type. Currently `CUPS Server` only; reserved for future Direct IPP support. |
| Host | `string` | ✅ | — | CUPS/IPP server hostname or IP (e.g. `cupsd`, `192.168.1.10`) |
| Port | `number` | — | `631` | IPP port |
| Username | `string` | — | `n8n` | Value sent as `requesting-user-name` in every IPP request |

The printer URI is constructed at runtime as `http://{host}:{port}/printers/{printerName}`.

### Test Connection

A "Test connection" button is available in the credential UI.

- **Implementation:** `testedBy: "printIppCredentialTest"` in the node description wires the button to `methods.credentialTest.printIppCredentialTest` on the `PrintIpp` node. The handler dispatches to `testCupsConnection()` based on `connectionType`.
- **Protocol (CUPS):** Sends a `CUPS-Get-Printers` IPP operation to `http://{host}:{port}/` (the CUPS root endpoint, no printer name required). `CUPS-Get-Printers` (op code `0x4002`) is a CUPS extension not present in the `ipp` package's standard operations table and is registered at module load time via monkey-patch.
- **Success:** Connection established and at least 1 printer found. n8n displays `"Connection tested successfully"` (n8n hardcodes this message for all OK results).
- **Failure (no printers):** `"Connection failed: no printers found"` — CUPS responded but the printer list was empty.
- **Failure (network/IPP error):** `"Connection failed"` (any network or IPP error).

### Printer Attribute Discovery

When a printer is selected in the Printer Name field, `Sides`, `Media`, and `Color Mode` load printer-specific supported values via `Get-Printer-Attributes` sent to `http://{host}:{port}/printers/{printerName}`. Requested attributes: `sides-supported`, `media-supported`, `print-color-mode-supported`.

On fetch failure (network error, printer offline), each field silently falls back to IPP General defaults — standard IPP/PWG keyword values labeled `(IPP General)` in the dropdown. A notice in the node panel informs the user to select a printer to load specific options.

### Printer List (CUPS dropdown)

When `connectionType === "cups"`, the Printer Name field supports dynamic discovery via `methods.listSearch.getCupsPrinters`:

- Sends `CUPS-Get-Printers` to the configured CUPS root endpoint.
- Returns printer entries as `{ name, value }` where `name` is `printer-name (printer-info)` (or `printer-name` alone if no info) and `value` is `printer-name`.
- Supports optional `filter` argument (case-insensitive substring match on name or info).
- If `connectionType` is not `cups`, returns an empty list.
- Implemented via the `fetchCupsPrinters(host, port, username, factory)` helper (also used by `testCupsConnection`).

The `printerName` field uses `type: "resourceLocator"` with two modes:
- **From List** (`list` mode): dropdown populated by `getCupsPrinters`, searchable.
- **By Name** (`id` mode): free-text input with placeholder `MyPrinter`; allows manual entry when the CUPS server is unreachable from the n8n editor or when the queue name is known in advance.

At runtime, `execute` reads the value using `{ extractValue: true }` so both modes resolve to a plain queue name string.

---

## Operation: Print Job

A single **Print Job** operation: sends a binary document to an IPP printer.

### Parameters

UI order: Printer Name → Binary Property → Copies → Sides → Media → Advanced Options.

#### Top-level

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Credential | `printIpp` | ✅ | — | Host, port, username |
| Printer Name | `resourceLocator` | ✅ | — | Printer queue name as registered on the CUPS server. Select from list (populated via `CUPS-Get-Printers`) or enter a queue name manually. |
| Binary Property | `string` | ✅ | `data` | n8n binary property name containing the document to print |
| Copies | `number` | — | `1` | Number of copies (IPP `copies` attribute) |
| Sides | `resourceLocator` | — | `one-sided` | Duplex setting. Select from printer-supported values (loaded via `Get-Printer-Attributes`) or enter manually. Shows IPP General defaults when no printer selected. |
| Media | `resourceLocator` | — | `iso_a4_210x297mm` | IPP media keyword. Select from printer-supported sizes or enter manually. Shows IPP General defaults when no printer selected. |
| Color Mode | `resourceLocator` | — | `color` | Color printing mode. Select from printer-supported modes or enter an IPP `print-color-mode` keyword manually. |

**Sides options:**

| Display | IPP value |
|---------|-----------|
| One-Sided | `one-sided` |
| Two-Sided (Long Edge / Portrait) | `two-sided-long-edge` |
| Two-Sided (Short Edge / Landscape) | `two-sided-short-edge` |

**Common Media values (free-text field with placeholder examples):**

| Description | IPP keyword |
|-------------|-------------|
| A4 | `iso_a4_210x297mm` |
| US Letter | `na_letter_8.5x11in` |
| A3 | `iso_a3_297x420mm` |
| US Legal | `na_legal_8.5x14in` |

### IPP General Defaults (shown when no printer selected or Get-Printer-Attributes fails)

All three dynamic fields fall back silently to these standard IPP/PWG values. Items are labeled `(IPP General)` in the dropdown.

**Sides**

| Display | IPP value |
|---------|-----------|
| One-Sided (IPP General) | `one-sided` |
| Two-Sided Long Edge (IPP General) | `two-sided-long-edge` |
| Two-Sided Short Edge (IPP General) | `two-sided-short-edge` |

**Media**

| Display | IPP value |
|---------|-----------|
| A4 (IPP General) | `iso_a4_210x297mm` |
| US Letter (IPP General) | `na_letter_8.5x11in` |
| A3 (IPP General) | `iso_a3_297x420mm` |
| US Legal (IPP General) | `na_legal_8.5x14in` |

**Color Mode**

| Display | IPP value |
|---------|-----------|
| Color (IPP General) | `color` |
| Monochrome (IPP General) | `monochrome` |
| Auto (IPP General) | `auto` |

#### Advanced Options (collection)

| Option | Name | Type | Default | Description |
|--------|------|------|---------|-------------|
| Job Name | `jobName` | `string` | `n8n print job` | Value sent as `job-name` in the IPP request |
| Document Format | `documentFormat` | `string` | `application/pdf` | IPP `document-format` MIME type |

---

## IPP Message Structure

```
operation-attributes-tag:
  requesting-user-name  ← credential.username
  job-name              ← Advanced Options > Job Name
  document-format       ← Advanced Options > Document Format

job-attributes-tag:
  copies                ← Copies
  sides                 ← Sides (extracted from resourceLocator)
  media                 ← Media (extracted from resourceLocator)
  print-color-mode      ← Color Mode (extracted from resourceLocator)

data                    ← binary buffer from Binary Property
```

The `ipp` package is called via `printer.execute("Print-Job", msg, callback)`.  
The callback is wrapped in a `Promise` for async/await usage.

---

## Output Schema

### Success

```json
{
  "job-id": 42,
  "job-uri": "ipp://cupsd:631/jobs/42",
  "job-state": "pending",
  "job-state-reasons": "none",
  "status-code": "successful-ok",
  "print-color-mode": "color"
}
```

Fields are taken directly from the IPP `Print-Job` response. `job-state` may be `pending`,
`pending-held`, `processing`, or `completed` depending on the printer.

### Error (`continueOnFail`)

```json
{
  "error": "...",
  "status-code": "..."
}
```

`status-code` is included when the IPP response carries a non-`successful-*` status code.

---

## Non-functional Requirements

- `continueOnFail()` is respected for all errors
- `usableAsTool: true` is set for AI Agent node support
- No system-level commands (`lp`, `lpr`, `cupsd` CLI) are invoked at runtime
- All IPP communication goes over HTTP to the CUPS/IPP endpoint

---

## API / Protocol Details

| Protocol | Transport |
|----------|-----------|
| IPP/2.0 | HTTP POST to `http://{host}:{port}/printers/{printerName}` |

The `ipp` package encodes the IPP binary message and handles the HTTP transport internally.

---

## Out of Scope (Future Consideration)

- TLS/IPPS support (`ipps://` scheme)
- Cancel-Job operation
- Multiple document support (multi-page job from separate binary items)
- Authentication (HTTP Basic / Kerberos for CUPS)
