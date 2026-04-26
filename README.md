# @a24k/n8n-nodes-printipp

[![CI](https://github.com/a24k/n8n-nodes-printipp/actions/workflows/ci.yml/badge.svg)](https://github.com/a24k/n8n-nodes-printipp/actions/workflows/ci.yml)

An [n8n](https://n8n.io/) community node that sends print jobs to IPP-capable printers (CUPS or direct IPP) using the [`ipp`](https://www.npmjs.com/package/ipp) npm package — no system-level `lp`, `lpr`, or printer drivers required.

## Why this node

Standard n8n has no built-in printing node. Common workarounds (Execute Command with `lp`) require the n8n host to have CUPS client tools installed and configured. This node communicates with any IPP endpoint over HTTP, making it work in any Docker or cloud deployment.

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
| Connection Type | Server type (`CUPS Server` only for now) | `CUPS Server` |
| Host | CUPS/IPP server hostname or IP (e.g. `cupsd`, `192.168.1.10`) | — |
| Port | IPP port | `631` |
| Username | Value sent as `requesting-user-name` | `n8n` |

Use the **Test connection** button to verify connectivity before saving.

The printer URI is constructed as `http://{host}:{port}/printers/{printerName}`.

## Operation: Print Job

Sends a binary document to an IPP printer queue.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| Printer Name | ✅ | — | Queue name. Select from the CUPS printer list (populated automatically) or type a name manually (e.g. `MyPrinter`). |
| Binary Property | ✅ | `data` | n8n binary property name containing the document |
| Copies | — | `1` | Number of copies |
| Sides | — | `one-sided` | Duplex setting. Select from printer-supported values (loaded automatically when printer is selected) or type a value manually. |
| Media | — | `iso_a4_210x297mm` | IPP media keyword. Select from printer-supported sizes (loaded automatically) or type a keyword manually. |
| Color Mode | — | `color` | Color mode. Select from printer-supported values (loaded automatically) or type a value manually (e.g. `color`, `monochrome`). |

**Advanced Options:**

| Option | Default | Description |
|--------|---------|-------------|
| Job Name | `n8n print job` | Value sent as `job-name` in the IPP request |
| Document Format | `application/pdf` | IPP `document-format` MIME type |

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
