# @a24k/n8n-nodes-printipp

[![CI](https://github.com/a24k/n8n-nodes-printipp/actions/workflows/ci.yml/badge.svg)](https://github.com/a24k/n8n-nodes-printipp/actions/workflows/ci.yml)

An [n8n](https://n8n.io/) community node that sends print jobs to IPP-capable printers (CUPS or direct IPP) using the [`ipp`](https://www.npmjs.com/package/ipp) npm package — no system-level `lp`, `lpr`, or printer drivers required.

## Why this node

Standard n8n has no built-in printing node. Common workarounds (Execute Command with `lp`) require the n8n host to have CUPS client tools installed and configured. This node communicates with any IPP endpoint over HTTP or HTTPS, making it work in any Docker or cloud deployment.

## Installation

In your n8n instance:

1. Go to **Settings → Community Nodes**
2. Click **Install**
3. Enter `@a24k/n8n-nodes-printipp`
4. Click **Install**

The node appears as **PrintIPP @a24k** in the node palette.

> Requires n8n 1.x or later.
> To use as an AI Agent tool, set `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` on your n8n instance.

## Credentials

Create a new **PrintIPP Endpoint** credential with:

| Field | Description | Default |
|-------|-------------|---------|
| Connection Type | `CUPS Server` for a CUPS print server, or `Direct IPP Printer` for a network printer (IPP Everywhere, AirPrint, vendor IPP) | `CUPS Server` |
| Protocol | `HTTP (IPP)` for plain HTTP, `HTTPS (IPPS)` for TLS-encrypted connections | `HTTP (IPP)` |
| Host | CUPS server or IPP printer hostname or IP (e.g. `cupsd`, `192.168.1.10`) | — |
| Port | IPP port | `631` |
| Printer Path | (Direct IPP only) Path component of the printer's IPP endpoint (e.g. `/ipp/print`, `/ipp/printer`, `/`) | `/ipp/print` |
| Username | Value sent as `requesting-user-name` | `n8n` |
| Password | HTTP Basic Authentication password. Leave empty to disable. | — |
| Skip Certificate Validation | Accept self-signed TLS certificates (shown when Protocol is HTTPS) | `false` |

Use the **Test connection** button to verify connectivity before saving.

**CUPS mode** URL: `{protocol}://{host}:{port}/printers/{printerName}`  
**Direct IPP mode** URL: `{protocol}://{host}:{port}{printerPath}`  
(Basic Auth credentials are embedded in the URL when a password is set.)

## Connection Modes

### CUPS Server

Use this mode when printing through a CUPS print server. The node lists all printers registered on the CUPS server and lets you pick one from a dropdown.

**Typical setup:** `cupsd` container or a host running CUPS accessible on port 631.

### Direct IPP Printer

Use this mode to print directly to an IPP-capable network printer without a CUPS server. Supported printer types:

- **IPP Everywhere** — most modern network printers (2013+) implement IPP Everywhere
- **AirPrint** — Apple wireless printing (uses IPP Everywhere underneath)
- **Vendor IPP** — many Brother, Epson, HP, Canon, and Ricoh printers expose `/ipp/print`

**Typical setup:**

1. Find the printer's hostname or IP address.
2. Set **Connection Type** to `Direct IPP Printer`.
3. Set **Host** to the printer's IP or hostname.
4. Set **Printer Path** to the printer's IPP path (usually `/ipp/print`; consult your printer's documentation if different).
5. Click **Test connection** to verify.

In Direct IPP mode, the **Printer Name** node field is not required and is ignored at runtime. The `Sides`, `Media`, and `Color Mode` dropdowns load printer-supported values as soon as the credential is configured.

## Operation: Print Job

Sends a binary document to an IPP printer queue.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| Printer Name | — | — | Queue name (CUPS mode only). Select from the CUPS printer list or type a name manually. Ignored in Direct IPP mode. |
| Binary Property | ✅ | `data` | n8n binary property name containing the document |
| Copies | — | `1` | Number of copies |
| Sides | — | One-Sided | Duplex setting. Select from printer-supported values (loaded automatically) or type a value manually. |
| Media | — | A4 | IPP media keyword. Select from printer-supported sizes (loaded automatically) or type a keyword manually. |
| Color Mode | — | Color | Color mode. Select from printer-supported values (loaded automatically) or type a value manually (e.g. `color`, `monochrome`). |
| Document Format | — | PDF | IPP `document-format` MIME type. Select from printer-supported formats (loaded automatically) or type a MIME type manually. |

> **Direct IPP note:** Network printers typically only accept formats they can process natively (usually `image/pwg-raster` or `image/urf`). CUPS servers accept many more formats because CUPS handles format conversion internally. When printing directly to an IPP printer, choose a format it actually supports.

**Advanced Options:**

| Option | Default | Description |
|--------|---------|-------------|
| Job Name | `n8n print job` | Value sent as `job-name` in the IPP request |

### Example workflow

```
HTTP Request (download PDF) → PrintIPP @a24k
```

Set **Binary Property** to `data` (the default output property of the HTTP Request node).

### Output

On success:

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

### Error handling

The node respects n8n's **Continue on Fail** setting. On failure:

```json
{
  "error": "...",
  "status-code": "..."
}
```

## License

[MIT](LICENSE)
