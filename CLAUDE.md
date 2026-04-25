# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Language Policy

All externally visible content must be written in **English**:
- Commit messages
- Pull request titles and descriptions
- Draft and requirements documents under `docs/`

Conversation with the user may be in any language.

## Project Overview

`@a24k/n8n-nodes-printipp` is an n8n community node that sends print jobs to IPP-capable printers (CUPS or direct IPP) using the `ipp` npm package. It requires no system-level dependencies (`lp`, `lpr`, etc.).

## Docs Structure

```
docs/
  requirements.md       # Living spec: current confirmed specification
  drafts/
    YYYYMMDD-<story>.md # One file per story; deleted after merging into requirements.md
```

**Always work from the draft file specified at the start of a session.**
Do not reference other draft files unless explicitly instructed.
When a story is complete, its content is merged into `requirements.md` and the draft file is deleted.

## Commands

```bash
# Install dependencies
bun install

# Build (compiles TypeScript to dist/ via tsc)
bun run build

# Lint
bun run lint
bun run lint:fix

# Publish
npm publish --access public

# Test
bun test
```

## Build System

`tsc --noEmit` performs type checking only. `node build.mjs` uses esbuild to
bundle each entry point (node + credential) into a single CJS file under
`dist/`. The `ipp` package is bundled inline; only `n8n-workflow` is marked
external (provided by n8n at runtime).

This means `dist/nodes/Printer/Printer.node.js` is self-contained and works
without a `node_modules/ipp` next to it — both in development (volume mount)
and in production (npm install).

```
tsc --noEmit          type-check
node build.mjs        bundle → dist/
```

## Architecture

```
src/
  nodes/
    Printer/
      Printer.node.ts       # Main node definition
      printer.svg           # Node icon
  credentials/
    IppApi.credentials.ts   # host, port, username
dist/                       # Compiled output (generated, do not edit)
docs/
  requirements.md
  drafts/
```

## Key Implementation Rules

### Credential

Define a new `ippApi` credential type in `src/credentials/IppApi.credentials.ts`.

Fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | — | CUPS/IPP server hostname or IP (e.g. `cupsd`, `192.168.1.10`) |
| `port` | `number` | `631` | IPP port |
| `username` | `string` | `n8n` | `requesting-user-name` sent with each job |

The printer URI is constructed at runtime: `http://{host}:{port}/printers/{printerName}`

### ipp Package

The node uses the [`ipp`](https://www.npmjs.com/package/ipp) npm package (v2.x) as a runtime dependency.

The package uses callbacks. Wrap in a `Promise`:

```typescript
import ipp from "ipp";

function printJob(printerUrl: string, message: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const printer = ipp.Printer(printerUrl);
    printer.execute("Print-Job", message, (err: Error | null, res: object) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}
```

The `ipp` package has no TypeScript types. Declare a minimal ambient module in `src/types/ipp.d.ts`.

### IPP Message Structure

```typescript
const msg = {
  "operation-attributes-tag": {
    "requesting-user-name": username,
    "job-name": jobName,
    "document-format": "application/pdf",
  },
  "job-attributes-tag": {
    copies: copies,
    sides: sides,
    media: media,
  },
  data: buffer, // Buffer containing PDF binary
};
```

### Binary Data

Read binary property from n8n item:

```typescript
const binaryMeta = this.helpers.assertBinaryData(i, binaryProperty);
const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
```

`document-format` defaults to `application/pdf`. If the binary item's `mimeType` differs, surface it as an advanced option.

### continueOnFail

Always wrap execution in try/catch and respect `this.continueOnFail()`.

### AI Agent Support

Set `usableAsTool: true` in the node description.

## package.json Requirements

```json
{
  "name": "@a24k/n8n-nodes-printipp",
  "keywords": ["n8n-community-node-package"],
  "n8n": {
    "n8nNodesApiVersion": 1,
    "nodes": ["dist/nodes/Printer/Printer.node.js"],
    "credentials": ["dist/credentials/IppApi.credentials.js"]
  },
  "dependencies": {
    "ipp": "^2.0.1"
  }
}
```

## Publishing

```bash
bun run build
npm publish --access public
```
