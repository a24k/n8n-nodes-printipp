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
| Connection Type | `options` | — | `cups` | Server type: `CUPS Server` or `Direct IPP Printer`. |
| Protocol | `options` | — | `http` | Transport protocol: `HTTP (IPP)` or `HTTPS (IPPS)`. |
| Host | `string` | ✅ | — | CUPS server or IPP printer hostname or IP (e.g. `cupsd`, `192.168.1.10`) |
| Port | `number` | — | `631` | IPP port |
| Printer Path | `string` | `/ipp/print` | Path component of the printer's IPP endpoint (e.g. `/ipp/print`, `/ipp/printer`, `/`). Visible only when Connection Type is Direct IPP Printer. |
| Username | `string` | — | `n8n` | Value sent as `requesting-user-name` in every IPP request |
| Password | `string` (secret) | — | `""` | HTTP Basic Authentication password. Leave empty to disable Basic Auth. |
| Skip Certificate Validation | `boolean` | — | `false` | Accept self-signed or untrusted TLS certificates. Visible only when Protocol is HTTPS. |

The printer URI is constructed at runtime by `resolvePrinterPath(connectionType, printerName, printerPath)` and `buildIppUrl(protocol, host, port, path, username, password)`:
- **CUPS mode:** `{protocol}://{host}:{port}/printers/{printerName}`
- **Direct IPP mode:** `{protocol}://{host}:{port}{printerPath}`

When `password` is non-empty, Basic Auth credentials are embedded in the URL.

### Test Connection

A "Test connection" button is available in the credential UI.

- **Implementation:** `testedBy: "printIppCredentialTest"` in the node description wires the button to `methods.credentialTest.printIppCredentialTest` on the `PrintIpp` node. The handler dispatches based on `connectionType`.
- **CUPS mode:** Sends a `CUPS-Get-Printers` IPP operation to `{protocol}://{host}:{port}/` (the CUPS root endpoint, no printer name required). `CUPS-Get-Printers` (op code `0x4002`) is a CUPS extension not present in the `ipp` package's standard operations table and is registered at module load time via monkey-patch.
  - Success: at least 1 printer found.
  - Failure (no printers): `"Connection failed: no printers found"`.
- **Direct IPP mode:** Sends `Get-Printer-Attributes` to `{protocol}://{host}:{port}{printerPath}` requesting `printer-state`, `printer-state-reasons`, `printer-name`.
  - Success: `"Connected successfully (printer-state: idle)"`.
  - Printer state `stopped`: `OK` with `"Connected, but printer state is 'stopped'"`.
  - No `printer-attributes-tag` in response: `"Connection failed: no printer attributes returned"`.
- **Both modes:** Failure (certificate error): `"Connection failed: certificate validation error"`. Other errors: `"Connection failed"`.

### Printer Attribute Discovery

`Sides`, `Media`, and `Color Mode` load printer-specific supported values via `Get-Printer-Attributes`. Requested attributes: `sides-supported`, `media-supported`, `print-color-mode-supported`.

- **CUPS mode:** When a printer is selected in the Printer Name field, the request is sent to `{protocol}://{host}:{port}/printers/{printerName}`. Falls back to IPP General defaults when no printer is selected or fetch fails.
- **Direct IPP mode:** The request is sent to `{protocol}://{host}:{port}{printerPath}` as soon as the credential is configured (no printer name needed). Falls back to IPP General defaults on fetch failure.

On fetch failure (network error, printer offline), each field silently falls back to IPP General defaults — standard IPP/PWG keyword values labeled `(IPP General)` in the dropdown.

### Printer List (CUPS dropdown)

When `connectionType === "cups"`, the Printer Name field supports dynamic discovery via `methods.listSearch.getCupsPrinters`:

- Sends `CUPS-Get-Printers` to the configured CUPS root endpoint.
- Returns printer entries as `{ name, value }` where `name` is `printer-name (printer-info)` (or `printer-name` alone if no info) and `value` is `printer-name`.
- Supports optional `filter` argument (case-insensitive substring match on name or info).
- If `connectionType` is not `cups`, returns an empty list.
- Implemented via the `fetchCupsPrinters(host, port, username, factory, protocol, password, skipCertValidation)` helper (also used by `testCupsConnection`).

The `printerName` field uses `type: "resourceLocator"` with two modes:
- **From List** (`list` mode): dropdown populated by `getCupsPrinters`, searchable.
- **By Name** (`id` mode): free-text input with placeholder `MyPrinter`; allows manual entry when the CUPS server is unreachable from the n8n editor or when the queue name is known in advance.

At runtime, `execute` reads the value using `{ extractValue: true }` so both modes resolve to a plain queue name string. When `connectionType === "ipp"`, the Printer Name field is not required and its value is ignored at runtime.

---

## Operation: Print Job

A single **Print Job** operation: sends a binary document to an IPP printer.

### Parameters

UI order: Printer Name → Binary Property → Copies → Sides → Media → Color Mode → Document Format → Advanced Options.

#### Top-level

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Credential | `printIpp` | ✅ | — | Host, port, username |
| Printer Name | `resourceLocator` | ✅ | — | Printer queue name as registered on the CUPS server. Select from list (populated via `CUPS-Get-Printers`) or enter a queue name manually. |
| Binary Property | `string` | ✅ | `data` | n8n binary property name containing the document to print |
| Copies | `number` | — | `1` | Number of copies (IPP `copies` attribute) |
| Sides | `resourceLocator` | — | One-Sided (IPP General) | Duplex setting. Select from printer-supported values (loaded via `Get-Printer-Attributes`) or enter manually. Shows IPP General defaults when no printer selected. |
| Media | `resourceLocator` | — | A4 (IPP General) | IPP media keyword. Select from printer-supported sizes or enter manually. Shows IPP General defaults when no printer selected. |
| Color Mode | `resourceLocator` | — | Color (IPP General) | Color printing mode. Select from printer-supported modes or enter an IPP `print-color-mode` keyword manually. |
| Document Format | `resourceLocator` | — | PDF (IPP General) | IPP `document-format` MIME type. Select from printer-supported formats (loaded via `Get-Printer-Attributes`) or enter a MIME type manually. |

**Sides options (IPP General defaults):**

| Display | IPP value |
|---------|-----------|
| One-Sided | `one-sided` |
| Two-Sided (Long Edge / Portrait) | `two-sided-long-edge` |
| Two-Sided (Short Edge / Landscape) | `two-sided-short-edge` |

**Common Media values (IPP General defaults):**

| Display | IPP value |
|---------|-----------|
| A4 | `iso_a4_210x297mm` |
| US Letter | `na_letter_8.5x11in` |
| A3 | `iso_a3_297x420mm` |
| US Legal | `na_legal_8.5x14in` |

### IPP General Defaults (shown when no printer selected or Get-Printer-Attributes fails)

All four dynamic fields fall back silently to these standard IPP/PWG values. Items are labeled `(IPP General)` in the dropdown.

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

### Friendly Display Names for Printer-Specific Values

When printer-specific values are fetched via `Get-Printer-Attributes`, known IPP/PWG keywords are mapped to human-readable labels. Unknown keywords fall back to the raw value. Custom sizes (`custom_*` keys) are rendered as `Custom (<dimensions>)`.

Implemented via `SIDES_LABELS`, `COLOR_MODE_LABELS`, `MEDIA_LABELS`, and `DOCUMENT_FORMAT_LABELS` maps plus a `labelMedia(v)` function (handles both the static map and the `custom_*` pattern). The `listPrinterAttribute` helper accepts a `labeler: (v: string) => string` function so each field can apply its own transform.

**Color Mode**

| Display | IPP value |
|---------|-----------|
| Color (IPP General) | `color` |
| Monochrome (IPP General) | `monochrome` |
| Auto (IPP General) | `auto` |

**Document Format**

| Display | IPP value |
|---------|-----------|
| PDF (IPP General) | `application/pdf` |
| PWG Raster (IPP General) | `image/pwg-raster` |
| Apple Raster / URF (IPP General) | `image/urf` |
| Auto-detect (IPP General) | `application/octet-stream` |

> **Note on format support:** Direct IPP printers typically only accept formats they can process natively (e.g. `image/pwg-raster`, `image/urf`). CUPS servers expose many formats because CUPS applies filter chains for format conversion. When printing directly to an IPP printer, select a format the printer actually supports or use a CUPS server for conversion.

#### Printer Attribute Discovery — Document Format

`Document Format` loads printer-supported MIME types via `Get-Printer-Attributes`, requesting `document-format-supported`. Follows the same pattern as `Sides`, `Media`, and `Color Mode`.

- **CUPS mode:** Request is sent to `{protocol}://{host}:{port}/printers/{printerName}` when a printer is selected. Falls back to IPP General defaults when no printer is selected or fetch fails.
- **Direct IPP mode:** Request is sent to `{protocol}://{host}:{port}{printerPath}` as soon as the credential is configured.

#### Advanced Options (collection)

| Option | Name | Type | Default | Description |
|--------|------|------|---------|-------------|
| Job Name | `jobName` | `string` | `n8n print job` | Value sent as `job-name` in the IPP request |

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

---

## API / Protocol Details

| Mode | Protocol | Transport |
|------|----------|-----------|
| CUPS | IPP/2.0 | HTTP POST to `{protocol}://{host}:{port}/printers/{printerName}` |
| CUPS | IPPS/2.0 | HTTPS POST (TLS) to `https://{host}:{port}/printers/{printerName}` |
| Direct IPP | IPP/2.0 | HTTP POST to `{protocol}://{host}:{port}{printerPath}` |
| Direct IPP | IPPS/2.0 | HTTPS POST (TLS) to `https://{host}:{port}{printerPath}` |

The `ipp` package encodes the IPP binary message and handles the HTTP/HTTPS transport internally. TLS options (`rejectUnauthorized`) are passed via the `IppConnectionOptions` interface to the `IppPrinterFactory`.

---

## Out of Scope (Future Consideration)

- Cancel-Job operation
- Multiple document support (multi-page job from separate binary items)
- Kerberos authentication for CUPS
- mDNS / Bonjour discovery of Direct IPP printers (users provide host/port manually)
- Credential-aware `displayOptions` for hiding the Printer Name field in Direct IPP mode (currently the field is always visible but ignored at runtime)
