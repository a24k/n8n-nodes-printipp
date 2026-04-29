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

`tsc --noEmit` performs type checking only. `bun build.mjs` uses Bun's native
bundler to produce a single CJS file per entry point under `dist/`. The `ipp`
package is bundled inline; only `n8n-workflow` is marked external (provided by
n8n at runtime).

This means `dist/nodes/PrintIpp/PrintIpp.node.js` is self-contained and works
without a `node_modules/ipp` next to it — both in development (volume mount)
and in production (npm install).

```
tsc --noEmit          type-check
bun build.mjs         bundle → dist/
```

## Architecture

```
src/
  nodes/
    PrintIpp/
      PrintIpp.node.ts      # Main node definition
      printipp.svg          # Node icon
  credentials/
    PrintIpp.credentials.ts # Credential fields
  types/
    ipp.d.ts                # Ambient type declarations for the ipp package
dist/                       # Compiled output (generated, do not edit)
docs/
  requirements.md
  drafts/
```

## Key Implementation Rules

### Credential

Define the `printIpp` credential type in `src/credentials/PrintIpp.credentials.ts` (display name: **PrintIPP Endpoint**).

Fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `connectionType` | `options` | `cups` | Server type. Currently `CUPS Server` only. |
| `protocol` | `options` | `http` | Transport: `http` or `https`. |
| `host` | `string` | — | CUPS/IPP server hostname or IP (e.g. `cupsd`, `192.168.1.10`) |
| `port` | `number` | `631` | IPP port |
| `username` | `string` | `n8n` | `requesting-user-name` sent with each job |
| `password` | `string` (secret) | `""` | HTTP Basic Auth password. Empty = no auth. |
| `skipCertValidation` | `boolean` | `false` | Accept self-signed TLS certs. Shown only when `protocol = https`. |

The printer URI is constructed at runtime via `buildIppUrl(protocol, host, port, path, username, password)`. Basic Auth credentials are embedded in the URL when `password` is non-empty.

### ipp Package

The node uses the [`ipp`](https://www.npmjs.com/package/ipp) npm package (v2.x) as a runtime dependency. It is bundled into `dist/` via `bun build.mjs` so no separate install is needed at runtime.

The package uses callbacks. The node wraps them in a `Promise` via a local `executeIppJob` closure captured in the constructor. This pattern also enables dependency injection of a mock `IppPrinterFactory` in tests:

```typescript
export interface IppConnectionOptions {
  rejectUnauthorized: boolean;
}

export type IppPrinterFactory = (
  url: string,
  options: IppConnectionOptions,
) => IppPrinterInstance;

constructor(printerFactory: IppPrinterFactory = defaultPrinterFactory) {
  const executeIppJob = (
    url: string,
    options: IppConnectionOptions,
    message: object,
  ): Promise<IppResponse> => {
    const printer = printerFactory(url, options);
    return new Promise((resolve, reject) => {
      printer.execute("Print-Job", message, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  };

  this.execute = async function (this: IExecuteFunctions) { ... };
}
```

The `ipp` package has no TypeScript types. Declare a minimal ambient module in `src/types/ipp.d.ts`.

### URL and Connection Helpers

Two exported helpers centralise URL construction and TLS options:

```typescript
// Builds the full IPP URL; embeds Basic Auth when password is non-empty
export function buildIppUrl(
  protocol: string,
  host: string,
  port: number,
  path: string,
  username: string,
  password: string,
): string

// Maps skipCertValidation → IppConnectionOptions
export function buildConnectionOptions(
  skipCertValidation: boolean,
): IppConnectionOptions
```

All four call sites (`fetchPrinterAttributes`, `fetchCupsPrinters`, `executeIppJob`, `testCupsConnection`) use these helpers and read `protocol`, `password`, `skipCertValidation` from the credential.

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
    sides,
    media,
    "print-color-mode": colorMode,
  },
  data: buffer, // Buffer containing PDF binary
};
```

### Binary Data

Read binary property from n8n item:

```typescript
const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
```

`document-format` defaults to `application/pdf` and can be overridden via Advanced Options.

### Dynamic Dropdown Fields (resourceLocator)

`Sides`, `Media`, and `Color Mode` use `type: "resourceLocator"` with `list` + `id` modes. Each field's `listSearch` method calls `listPrinterAttribute` to fetch printer-specific values or fall back to static IPP General defaults.

**`cachedResultName`** must be set in the field `default` so n8n displays the friendly name before the list is loaded:

```typescript
default: { mode: "list", value: "one-sided", cachedResultName: "One-Sided (IPP General)" }
```

**Labeler pattern** — `listPrinterAttribute` takes a `labeler: (v: string) => string` function so each field applies its own display transform. For media, `labelMedia(v)` checks a static map first, then handles `custom_*` keys dynamically:

```typescript
function labelMedia(v: string): string {
  if (MEDIA_LABELS[v]) return MEDIA_LABELS[v];
  const customMatch = /^custom_(\S+?)_\S+$/.exec(v);
  if (customMatch) return `Custom (${customMatch[1]})`;
  return v;
}
```

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
    "nodes": ["dist/nodes/PrintIpp/PrintIpp.node.js"],
    "credentials": ["dist/credentials/PrintIpp.credentials.js"]
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
