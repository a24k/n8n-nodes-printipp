# Credential Test Connection — Design

## Overview

Add a "Test connection" button to the `ippApi` credential UI. When clicked, n8n sends a `CUPS-Get-Printers` IPP request to the configured CUPS server and reports the number of printers found.

## Requirements

- Success: "Connected successfully (N printers found)" — even when N = 0
- Failure: "Connection failed" (single-line, consistent with n8n official nodes)
- No new fields added to the credential

## Architecture

n8n's credential testing for non-HTTP protocols uses the `methods.credentialTest` pattern:

```
nodeDescription.credentials[].testedBy  →  "ippCredentialTest"
                                               ↓
Printer.node.ts methods.credentialTest.ippCredentialTest()
                                               ↓
                                    testIppConnection() helper
                                               ↓
                             CUPS-Get-Printers IPP request
                             http://{host}:{port}/
```

`IppApi.credentials.ts` requires **no changes** — the `test` property on `ICredentialType` is HTTP-only and not used for IPP.

## Data Flow

1. User clicks "Test connection" in UI
2. n8n resolves `testedBy: 'ippCredentialTest'` → calls `methods.credentialTest.ippCredentialTest`
3. Function extracts `host`, `port`, `username` from `credential.data`
4. Calls `testIppConnection(host, port, username)` helper
5. Helper sends `CUPS-Get-Printers` to `http://{host}:{port}/` via `printerFactory`
6. Counts entries in `printer-attributes-tag` array (0 if absent)
7. Returns `{ status: 'OK', message: 'Connected successfully (N printers found)' }`
   or `{ status: 'Error', message: 'Connection failed' }` on any error

## IPP Message

```typescript
{
  "operation-attributes-tag": {
    "requesting-user-name": username,
  }
}
```

Sent via `printer.execute("CUPS-Get-Printers", message, callback)` to the CUPS root endpoint.

## Files Changed

### `src/nodes/Printer/Printer.node.ts`

1. Add `testedBy: 'ippCredentialTest'` to `nodeDescription.credentials[0]`
2. Export `testIppConnection(host, port, username, printerFactory?)` — standalone async function accepting an optional factory for DI
3. Add `methods` object to `Printer` class:

```typescript
methods = {
  credentialTest: {
    async ippCredentialTest(
      this: ICredentialTestFunctions,
      credential: ICredentialsDecrypted,
    ): Promise<INodeCredentialTestResult> {
      const { host, port, username } = credential.data as {
        host: string;
        port: number;
        username: string;
      };
      return testIppConnection(host, port, username);
    },
  },
};
```

### `src/types/ipp.d.ts`

Add response type for `CUPS-Get-Printers`:

```typescript
interface CupsGetPrintersResponse {
  statusCode?: string;
  "printer-attributes-tag"?: Array<{
    "printer-name"?: string;
    "printer-state"?: string;
  }>;
}
```

### `src/credentials/IppApi.credentials.ts`

No changes required.

### `tests/Printer.node.test.ts`

Add unit tests for `testIppConnection` using mock `printerFactory`:

| Case | Mock response | Expected result |
|------|--------------|-----------------|
| 2 printers | `printer-attributes-tag: [{...}, {...}]` | OK, "2 printers found" |
| 0 printers | `printer-attributes-tag: []` | OK, "0 printers found" |
| Connection error | throws Error | Error, "Connection failed" |

## Types Used

| Type | Source | Purpose |
|------|--------|---------|
| `ICredentialTestFunctions` | `n8n-workflow` | `this` context in credentialTest |
| `ICredentialsDecrypted` | `n8n-workflow` | Credential data passed to test function |
| `INodeCredentialTestResult` | `n8n-workflow` | Return value `{ status, message }` |
