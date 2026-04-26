# Requirements

This document reflects the current confirmed specification.
It is updated incrementally as draft stories are completed and merged.

---

## Package

| Item | Value |
|------|-------|
| Package name | `@a24k/n8n-nodes-printipp` |
| Display name | `Printer (IPP) @a24k` |
| npm keyword | `n8n-community-node-package` |
| Target n8n version | 1.x and above |
| Runtime dependencies | `ipp` ^2.0.1 (pure-JS IPP implementation, no system deps) |

> **Note on Verified eligibility:** The `ipp` runtime dependency disqualifies this package from npm
> Verified node status. The dependency is intentional — it replaces the system-level `lp`/`lpr`
> command and enables IPP printing from any n8n deployment (Docker, cloud, etc.) without printer
> driver installation.

---

## Credential: `ippApi`

Defined in `src/credentials/IppApi.credentials.ts`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| Host | `string` | ✅ | — | CUPS/IPP server hostname or IP (e.g. `cupsd`, `192.168.1.10`) |
| Port | `number` | — | `631` | IPP port |
| Username | `string` | — | `n8n` | Value sent as `requesting-user-name` in every IPP request |

The printer URI is constructed at runtime as `http://{host}:{port}/printers/{printerName}`.

### Test Connection

A "Test connection" button is available in the credential UI.

- **Implementation:** `testedBy: "ippCredentialTest"` in the node description wires the button to `methods.credentialTest.ippCredentialTest` on the `Printer` node.
- **Protocol:** Sends a `CUPS-Get-Printers` IPP operation to `http://{host}:{port}/` (the CUPS root endpoint, no printer name required).
- **Success:** Connection established and at least 1 printer found. n8n displays `"Connection tested successfully"` (n8n hardcodes this message for all OK results).
- **Failure (no printers):** `"Connection failed: no printers found"` — CUPS responded but returned 0 printers.
- **Failure (network/IPP error):** `"Connection failed"` (any network or IPP error).

---

## Operation: Print Job

A single **Print Job** operation: sends a binary document to an IPP printer.

### Parameters

UI order: Printer Name → Binary Property → Copies → Sides → Media → Advanced Options.

#### Top-level

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Credential | `ippApi` | ✅ | — | Host, port, username |
| Printer Name | `string` | ✅ | — | Printer queue name as registered in CUPS (e.g. `PX-M6010F`) |
| Binary Property | `string` | ✅ | `data` | n8n binary property name containing the document to print |
| Copies | `number` | — | `1` | Number of copies (IPP `copies` attribute) |
| Sides | `options` | — | `one-sided` | Duplex setting (see values below) |
| Media | `string` | — | `iso_a4_210x297mm` | IPP media keyword (see common values below) |

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
  sides                 ← Sides
  media                 ← Media

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
  "status-code": "successful-ok"
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
- Get-Printer-Attributes operation (printer capability discovery)
- Cancel-Job operation
- Printer queue dropdown (dynamic population from CUPS API)
- Multiple document support (multi-page job from separate binary items)
- Authentication (HTTP Basic / Kerberos for CUPS)
