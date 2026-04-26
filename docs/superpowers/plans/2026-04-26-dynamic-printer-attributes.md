# Dynamic Printer Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic dropdowns for Sides, Media, and a new Color Mode field by fetching `Get-Printer-Attributes` from the selected printer, with static IPP General defaults as fallback.

**Architecture:** `fetchPrinterAttributes` is a new exported helper that sends `Get-Printer-Attributes` and returns a `PrinterAttributes | null`. Three new `listSearch` methods (`getSidesOptions`, `getMediaOptions`, `getColorModeOptions`) call it when a printer is selected and fall back silently to static defaults otherwise. `sides` and `media` are converted from `options`/`string` to `resourceLocator`; a new `colorMode` `resourceLocator` field is added.

**Tech Stack:** TypeScript, n8n-workflow, ipp (v2.x, callback-based), Bun test runner

---

## File Map

| File | Change |
|------|--------|
| `src/nodes/PrintIpp/PrintIpp.node.ts` | Add `PrinterAttributes` interface, widen `IppResponse["printer-attributes-tag"]` type, add `fetchPrinterAttributes` export, add static defaults constants, add 3 `listSearch` methods, update `sides`/`media` field definitions, add `colorMode` field, add notice field, update `execute` |
| `tests/Printer.node.test.ts` | Update `createMockLoadOptionsFunctions` (add `getCurrentNodeParameter`), update `createMockExecuteFunctions` (add `colorMode`), update `sides` description test, update `execute` assertions, add `fetchPrinterAttributes` tests, add 3 `listSearch` method tests |
| `docs/requirements.md` | Add Color Mode parameter, update Sides/Media descriptions, update IPP message structure, update output schema |
| `CLAUDE.md` | Update IPP Message Structure example to include `print-color-mode` |
| `README.md` | Add Color Mode to parameters table, update output JSON example |

---

## Task 1: Add `PrinterAttributes` + `fetchPrinterAttributes` (TDD)

**Files:**
- Modify: `tests/Printer.node.test.ts`
- Modify: `src/nodes/PrintIpp/PrintIpp.node.ts`

- [ ] **Step 1: Write the failing tests for `fetchPrinterAttributes`**

Add to `tests/Printer.node.test.ts`, after the `fetchCupsPrinters` describe block (around line 521), adding `fetchPrinterAttributes` to the import:

```typescript
import {
  fetchCupsPrinters,
  fetchPrinterAttributes,
  PrintIpp,
  testCupsConnection,
} from "../src/nodes/PrintIpp/PrintIpp.node";
```

Then add this describe block at the end of the file:

```typescript
describe("fetchPrinterAttributes", () => {
  it("sends Get-Printer-Attributes to the printer URL", async () => {
    const capturedUrls: string[] = [];
    const capturedOps: string[] = [];
    const factory = makeIppFactory((url, operation) => {
      capturedUrls.push(url);
      capturedOps.push(operation);
      return {
        statusCode: "successful-ok",
        "printer-attributes-tag": {
          "sides-supported": ["one-sided", "two-sided-long-edge"],
          "media-supported": ["iso_a4_210x297mm"],
          "print-color-mode-supported": ["color"],
        } as unknown as Array<Record<string, unknown>>,
      };
    });
    await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(capturedUrls[0]).toBe("http://cupsd:631/printers/MyPrinter");
    expect(capturedOps[0]).toBe("Get-Printer-Attributes");
  });

  it("returns parsed attributes on success", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": ["one-sided", "two-sided-long-edge"],
        "media-supported": ["iso_a4_210x297mm", "na_letter_8.5x11in"],
        "print-color-mode-supported": ["color", "monochrome"],
      } as unknown as Array<Record<string, unknown>>,
    }));
    const result = await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(result).toEqual({
      sidesSupported: ["one-sided", "two-sided-long-edge"],
      mediaSupported: ["iso_a4_210x297mm", "na_letter_8.5x11in"],
      colorModesSupported: ["color", "monochrome"],
    });
  });

  it("wraps single-value string attribute in array", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": "one-sided",
        "media-supported": "iso_a4_210x297mm",
        "print-color-mode-supported": "color",
      } as unknown as Array<Record<string, unknown>>,
    }));
    const result = await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(result?.sidesSupported).toEqual(["one-sided"]);
    expect(result?.mediaSupported).toEqual(["iso_a4_210x297mm"]);
    expect(result?.colorModesSupported).toEqual(["color"]);
  });

  it("returns null on network error", async () => {
    const factory = makeIppFactory(() => new Error("Connection refused"));
    const result = await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(result).toBeNull();
  });

  it("returns empty arrays for missing attributes", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {} as unknown as Array<Record<string, unknown>>,
    }));
    const result = await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(result?.sidesSupported).toEqual([]);
    expect(result?.mediaSupported).toEqual([]);
    expect(result?.colorModesSupported).toEqual([]);
  });

  it("returns null when printer-attributes-tag is absent", async () => {
    const factory = makeIppFactory(() => ({ statusCode: "successful-ok" }));
    const result = await fetchPrinterAttributes("cupsd", 631, "MyPrinter", "n8n", factory);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test 2>&1 | tail -20
```

Expected: multiple failures referencing `fetchPrinterAttributes` not exported.

- [ ] **Step 3: Add `PrinterAttributes` interface, widen `IppResponse` type, and implement `fetchPrinterAttributes`**

In `src/nodes/PrintIpp/PrintIpp.node.ts`, update the `IppResponse` interface (line 20-29):

```typescript
export interface IppResponse {
  statusCode?: string;
  "job-attributes-tag"?: {
    "job-id"?: number;
    "job-uri"?: string;
    "job-state"?: string;
    "job-state-reasons"?: string;
  };
  "printer-attributes-tag"?: Array<Record<string, unknown>> | Record<string, unknown>;
}
```

Add after the `CupsPrinterEntry` interface definition (after line 47):

```typescript
export interface PrinterAttributes {
  sidesSupported: string[];
  mediaSupported: string[];
  colorModesSupported: string[];
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return (val as unknown[]).filter((v): v is string => typeof v === "string");
  if (typeof val === "string") return [val];
  return [];
}

export async function fetchPrinterAttributes(
  host: string,
  port: number,
  printerName: string,
  username: string,
  printerFactory: IppPrinterFactory = defaultPrinterFactory,
): Promise<PrinterAttributes | null> {
  try {
    const printerUrl = `http://${host}:${port}/printers/${printerName}`;
    const printer = printerFactory(printerUrl);
    const response = await new Promise<IppResponse>((resolve, reject) => {
      printer.execute(
        "Get-Printer-Attributes",
        {
          "operation-attributes-tag": {
            "requesting-user-name": username,
            "requested-attributes": [
              "sides-supported",
              "media-supported",
              "print-color-mode-supported",
            ],
          },
        },
        (err, res) => {
          if (err) reject(err);
          else resolve(res);
        },
      );
    });

    const rawAttrs = response["printer-attributes-tag"];
    if (!rawAttrs) return null;
    // Get-Printer-Attributes always returns a single object, but normalise
    // in case the ipp library wraps it in a single-element array.
    const attrs: Record<string, unknown> = Array.isArray(rawAttrs)
      ? (rawAttrs[0] ?? {})
      : (rawAttrs as Record<string, unknown>);

    return {
      sidesSupported: toStringArray(attrs["sides-supported"]),
      mediaSupported: toStringArray(attrs["media-supported"]),
      colorModesSupported: toStringArray(attrs["print-color-mode-supported"]),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test 2>&1 | grep -E "fetchPrinterAttributes|PASS|FAIL|✓|✗"
```

Expected: all `fetchPrinterAttributes` tests pass.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
bun test
```

Expected: all previously passing tests still pass.

- [ ] **Step 6: Run type check and lint**

```bash
bun run build && bun run lint
```

Expected: no errors, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/nodes/PrintIpp/PrintIpp.node.ts tests/Printer.node.test.ts
git commit -m "feat: add fetchPrinterAttributes helper with Get-Printer-Attributes support"
```

---

## Task 2: Add `getSidesOptions`, `getMediaOptions`, `getColorModeOptions` listSearch methods (TDD)

**Files:**
- Modify: `tests/Printer.node.test.ts`
- Modify: `src/nodes/PrintIpp/PrintIpp.node.ts`

- [ ] **Step 1: Update `createMockLoadOptionsFunctions` to support `getCurrentNodeParameter`**

In `tests/Printer.node.test.ts`, replace the existing `createMockLoadOptionsFunctions` function (lines 523-541) with:

```typescript
function createMockLoadOptionsFunctions(
  credentialsOverride?: Partial<{
    host: string;
    port: number;
    username: string;
    connectionType: string;
  }>,
  currentNodeParams?: Record<string, unknown>,
): ILoadOptionsFunctions {
  const credentials = {
    host: "cupsd",
    port: 631,
    username: "n8n",
    connectionType: "cups",
    ...credentialsOverride,
  };
  const nodeParams = currentNodeParams ?? {};
  return {
    getCredentials: async (_name: string) => credentials,
    getCurrentNodeParameter: (name: string) => nodeParams[name] ?? "",
  } as unknown as ILoadOptionsFunctions;
}
```

- [ ] **Step 2: Add helper functions for the new listSearch methods**

In `tests/Printer.node.test.ts`, after the existing `getCupsPrinters` helper function (after line 547), add:

```typescript
function getSidesOptions(node: PrintIpp) {
  const fn = node.methods?.listSearch?.getSidesOptions;
  if (!fn) throw new Error("getSidesOptions not found");
  return fn;
}

function getMediaOptions(node: PrintIpp) {
  const fn = node.methods?.listSearch?.getMediaOptions;
  if (!fn) throw new Error("getMediaOptions not found");
  return fn;
}

function getColorModeOptions(node: PrintIpp) {
  const fn = node.methods?.listSearch?.getColorModeOptions;
  if (!fn) throw new Error("getColorModeOptions not found");
  return fn;
}
```

- [ ] **Step 3: Write the failing tests for the three new listSearch methods**

Add the following describe blocks at the end of `tests/Printer.node.test.ts` (before the `fetchPrinterAttributes` block):

```typescript
describe("listSearch.getSidesOptions", () => {
  it("returns IPP General defaults when printerName is empty", async () => {
    const node = new PrintIpp(makeIppFactory(() => ({ statusCode: "successful-ok" })));
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
    const result = await getSidesOptions(node).call(ctx);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({ name: "One-Sided (IPP General)", value: "one-sided" });
    expect(result.results[1]).toEqual({ name: "Two-Sided Long Edge (IPP General)", value: "two-sided-long-edge" });
    expect(result.results[2]).toEqual({ name: "Two-Sided Short Edge (IPP General)", value: "two-sided-short-edge" });
  });

  it("returns printer-specific values when printerName is set and fetch succeeds", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": ["one-sided"],
        "media-supported": [],
        "print-color-mode-supported": [],
      } as unknown as Array<Record<string, unknown>>,
    }));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getSidesOptions(node).call(ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ name: "one-sided", value: "one-sided" });
  });

  it("falls back to IPP General defaults when fetch fails", async () => {
    const factory = makeIppFactory(() => new Error("Printer offline"));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getSidesOptions(node).call(ctx);
    expect(result.results).toHaveLength(3);
    expect(result.results[0].value).toBe("one-sided");
  });

  it("falls back to IPP General defaults when printer returns empty sides-supported", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": [],
        "media-supported": [],
        "print-color-mode-supported": [],
      } as unknown as Array<Record<string, unknown>>,
    }));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getSidesOptions(node).call(ctx);
    expect(result.results).toHaveLength(3);
  });

  it("filters results by name (case-insensitive)", async () => {
    const node = new PrintIpp(makeIppFactory(() => ({ statusCode: "successful-ok" })));
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
    const result = await getSidesOptions(node).call(ctx, "two-sided");
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.value.includes("two-sided"))).toBe(true);
  });
});

describe("listSearch.getMediaOptions", () => {
  it("returns IPP General defaults when printerName is empty", async () => {
    const node = new PrintIpp(makeIppFactory(() => ({ statusCode: "successful-ok" })));
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
    const result = await getMediaOptions(node).call(ctx);
    expect(result.results).toHaveLength(4);
    expect(result.results[0]).toEqual({ name: "A4 (IPP General)", value: "iso_a4_210x297mm" });
    expect(result.results[1]).toEqual({ name: "US Letter (IPP General)", value: "na_letter_8.5x11in" });
    expect(result.results[2]).toEqual({ name: "A3 (IPP General)", value: "iso_a3_297x420mm" });
    expect(result.results[3]).toEqual({ name: "US Legal (IPP General)", value: "na_legal_8.5x14in" });
  });

  it("returns printer-specific values when printerName is set and fetch succeeds", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": [],
        "media-supported": ["iso_a4_210x297mm", "iso_a3_297x420mm"],
        "print-color-mode-supported": [],
      } as unknown as Array<Record<string, unknown>>,
    }));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getMediaOptions(node).call(ctx);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ name: "iso_a4_210x297mm", value: "iso_a4_210x297mm" });
  });

  it("falls back to IPP General defaults when fetch fails", async () => {
    const factory = makeIppFactory(() => new Error("Printer offline"));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getMediaOptions(node).call(ctx);
    expect(result.results).toHaveLength(4);
  });
});

describe("listSearch.getColorModeOptions", () => {
  it("returns IPP General defaults when printerName is empty", async () => {
    const node = new PrintIpp(makeIppFactory(() => ({ statusCode: "successful-ok" })));
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
    const result = await getColorModeOptions(node).call(ctx);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({ name: "Color (IPP General)", value: "color" });
    expect(result.results[1]).toEqual({ name: "Monochrome (IPP General)", value: "monochrome" });
    expect(result.results[2]).toEqual({ name: "Auto (IPP General)", value: "auto" });
  });

  it("returns printer-specific values when printerName is set and fetch succeeds", async () => {
    const factory = makeIppFactory(() => ({
      statusCode: "successful-ok",
      "printer-attributes-tag": {
        "sides-supported": [],
        "media-supported": [],
        "print-color-mode-supported": ["color", "monochrome"],
      } as unknown as Array<Record<string, unknown>>,
    }));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getColorModeOptions(node).call(ctx);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ name: "color", value: "color" });
    expect(result.results[1]).toEqual({ name: "monochrome", value: "monochrome" });
  });

  it("falls back to IPP General defaults when fetch fails", async () => {
    const factory = makeIppFactory(() => new Error("Printer offline"));
    const node = new PrintIpp(factory);
    const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "MyPrinter" });
    const result = await getColorModeOptions(node).call(ctx);
    expect(result.results).toHaveLength(3);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
bun test 2>&1 | grep -E "getSidesOptions|getMediaOptions|getColorModeOptions|not found"
```

Expected: failures on `getSidesOptions not found`, `getMediaOptions not found`, `getColorModeOptions not found`.

- [ ] **Step 5: Add static defaults constants and the three listSearch methods to the node**

In `src/nodes/PrintIpp/PrintIpp.node.ts`, add these constants after the `fetchPrinterAttributes` function (before `const nodeDescription`):

```typescript
const SIDES_DEFAULTS = [
  { name: "One-Sided (IPP General)", value: "one-sided" },
  { name: "Two-Sided Long Edge (IPP General)", value: "two-sided-long-edge" },
  { name: "Two-Sided Short Edge (IPP General)", value: "two-sided-short-edge" },
];

const MEDIA_DEFAULTS = [
  { name: "A4 (IPP General)", value: "iso_a4_210x297mm" },
  { name: "US Letter (IPP General)", value: "na_letter_8.5x11in" },
  { name: "A3 (IPP General)", value: "iso_a3_297x420mm" },
  { name: "US Legal (IPP General)", value: "na_legal_8.5x14in" },
];

const COLOR_MODE_DEFAULTS = [
  { name: "Color (IPP General)", value: "color" },
  { name: "Monochrome (IPP General)", value: "monochrome" },
  { name: "Auto (IPP General)", value: "auto" },
];
```

Then in the `PrintIpp` constructor, inside `this.methods = { ... }`, add to `listSearch` alongside `getCupsPrinters`:

```typescript
async getSidesOptions(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const credentials = await this.getCredentials("printIpp");
  const { host, port, username } = credentials as {
    host: string;
    port: number;
    username: string;
  };
  const printerName = this.getCurrentNodeParameter("printerName", {
    extractValue: true,
  }) as string;

  let items = SIDES_DEFAULTS;
  if (printerName) {
    const attrs = await fetchPrinterAttributes(
      host,
      port,
      printerName,
      username,
      printerFactory,
    );
    if (attrs && attrs.sidesSupported.length > 0) {
      items = attrs.sidesSupported.map((v) => ({ name: v, value: v }));
    }
  }

  const results = filter
    ? items.filter((item) =>
        item.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : items;

  return { results };
},

async getMediaOptions(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const credentials = await this.getCredentials("printIpp");
  const { host, port, username } = credentials as {
    host: string;
    port: number;
    username: string;
  };
  const printerName = this.getCurrentNodeParameter("printerName", {
    extractValue: true,
  }) as string;

  let items = MEDIA_DEFAULTS;
  if (printerName) {
    const attrs = await fetchPrinterAttributes(
      host,
      port,
      printerName,
      username,
      printerFactory,
    );
    if (attrs && attrs.mediaSupported.length > 0) {
      items = attrs.mediaSupported.map((v) => ({ name: v, value: v }));
    }
  }

  const results = filter
    ? items.filter((item) =>
        item.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : items;

  return { results };
},

async getColorModeOptions(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const credentials = await this.getCredentials("printIpp");
  const { host, port, username } = credentials as {
    host: string;
    port: number;
    username: string;
  };
  const printerName = this.getCurrentNodeParameter("printerName", {
    extractValue: true,
  }) as string;

  let items = COLOR_MODE_DEFAULTS;
  if (printerName) {
    const attrs = await fetchPrinterAttributes(
      host,
      port,
      printerName,
      username,
      printerFactory,
    );
    if (attrs && attrs.colorModesSupported.length > 0) {
      items = attrs.colorModesSupported.map((v) => ({ name: v, value: v }));
    }
  }

  const results = filter
    ? items.filter((item) =>
        item.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : items;

  return { results };
},
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test 2>&1 | grep -E "getSidesOptions|getMediaOptions|getColorModeOptions|✓|✗"
```

Expected: all new listSearch tests pass.

- [ ] **Step 7: Run full test suite to check no regressions**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 8: Run type check and lint**

```bash
bun run build && bun run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/nodes/PrintIpp/PrintIpp.node.ts tests/Printer.node.test.ts
git commit -m "feat: add getSidesOptions, getMediaOptions, getColorModeOptions listSearch methods"
```

---

## Task 3: Update node property definitions (sides, media, colorMode, notice)

**Files:**
- Modify: `tests/Printer.node.test.ts`
- Modify: `src/nodes/PrintIpp/PrintIpp.node.ts`

- [ ] **Step 1: Update the `sides has correct options` test and add `colorMode` to required properties**

In `tests/Printer.node.test.ts`, find the `"has required properties"` test (around line 131) and add `"colorMode"`:

```typescript
it("has required properties", () => {
  const node = new PrintIpp();
  const names = node.description.properties.map((p) => p.name);
  expect(names).toContain("printerName");
  expect(names).toContain("binaryProperty");
  expect(names).toContain("copies");
  expect(names).toContain("sides");
  expect(names).toContain("media");
  expect(names).toContain("colorMode");
  expect(names).toContain("advancedOptions");
});
```

Replace the `"sides has correct options"` test (around line 161) with:

```typescript
it("sides is resourceLocator with list and id modes", () => {
  const node = new PrintIpp();
  const prop = node.description.properties.find((p) => p.name === "sides");
  expect(prop?.type).toBe("resourceLocator");
  const modes = prop?.modes ?? [];
  expect(modes.some((m) => m.name === "list")).toBe(true);
  expect(modes.some((m) => m.name === "id")).toBe(true);
});

it("media is resourceLocator with list and id modes", () => {
  const node = new PrintIpp();
  const prop = node.description.properties.find((p) => p.name === "media");
  expect(prop?.type).toBe("resourceLocator");
  const modes = prop?.modes ?? [];
  expect(modes.some((m) => m.name === "list")).toBe(true);
  expect(modes.some((m) => m.name === "id")).toBe(true);
});

it("colorMode is resourceLocator with list and id modes", () => {
  const node = new PrintIpp();
  const prop = node.description.properties.find((p) => p.name === "colorMode");
  expect(prop?.type).toBe("resourceLocator");
  const modes = prop?.modes ?? [];
  expect(modes.some((m) => m.name === "list")).toBe(true);
  expect(modes.some((m) => m.name === "id")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify the updated description tests fail**

```bash
bun test 2>&1 | grep -E "sides|media|colorMode|✗"
```

Expected: `sides is resourceLocator`, `media is resourceLocator`, `colorMode is resourceLocator`, `has required properties` fail.

- [ ] **Step 3: Update the `sides` field definition in `nodeDescription`**

In `src/nodes/PrintIpp/PrintIpp.node.ts`, replace the entire `sides` property definition in `nodeDescription.properties` with:

```typescript
{
  displayName: "Sides",
  name: "sides",
  type: "resourceLocator",
  required: false,
  default: { mode: "list", value: "one-sided" },
  description: "Duplex printing setting",
  modes: [
    {
      displayName: "From List",
      name: "list",
      type: "list",
      typeOptions: {
        searchListMethod: "getSidesOptions",
        searchable: false,
      },
    },
    {
      displayName: "By Value",
      name: "id",
      type: "string",
      placeholder: "one-sided",
    },
  ],
},
```

- [ ] **Step 4: Update the `media` field definition in `nodeDescription`**

Replace the entire `media` property definition in `nodeDescription.properties` with:

```typescript
{
  displayName: "Media",
  name: "media",
  type: "resourceLocator",
  required: false,
  default: { mode: "list", value: "iso_a4_210x297mm" },
  description: "IPP media keyword. Select from printer-supported sizes or enter a PWG media keyword manually.",
  modes: [
    {
      displayName: "From List",
      name: "list",
      type: "list",
      typeOptions: {
        searchListMethod: "getMediaOptions",
        searchable: true,
        searchFilterRequired: false,
      },
    },
    {
      displayName: "By Value",
      name: "id",
      type: "string",
      placeholder: "iso_a4_210x297mm",
    },
  ],
},
```

- [ ] **Step 5: Add `colorMode` field and notice field after `media` and before `advancedOptions`**

Insert two new entries in `nodeDescription.properties` after the `media` property definition and before `advancedOptions`:

```typescript
{
  displayName: "",
  name: "printerAttributesNotice",
  type: "notice",
  default: "",
  description:
    "Select a printer in the Printer Name field to load printer-specific options. Showing IPP General defaults.",
},
{
  displayName: "Color Mode",
  name: "colorMode",
  type: "resourceLocator",
  required: false,
  default: { mode: "list", value: "color" },
  description: "Color printing mode",
  modes: [
    {
      displayName: "From List",
      name: "list",
      type: "list",
      typeOptions: {
        searchListMethod: "getColorModeOptions",
        searchable: false,
      },
    },
    {
      displayName: "By Value",
      name: "id",
      type: "string",
      placeholder: "color",
    },
  ],
},
```

> **Note on notice `displayOptions`:** The spec calls for hiding the notice when a printer is selected. However, `displayOptions` on `resourceLocator` fields compares against the raw object value (not the extracted string), making this unreliable. For now, the notice is always visible — it is harmless when a printer is selected since the dropdown still loads printer-specific values. This can be revisited if n8n adds support for `extractValue` in `displayOptions`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test
```

Expected: all tests pass including the three new field-type tests.

- [ ] **Step 7: Run type check and lint**

```bash
bun run build && bun run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/nodes/PrintIpp/PrintIpp.node.ts tests/Printer.node.test.ts
git commit -m "feat: convert sides/media to resourceLocator, add colorMode field and notice"
```

---

## Task 4: Update `execute` to read resourceLocator fields and send `print-color-mode`

**Files:**
- Modify: `tests/Printer.node.test.ts`
- Modify: `src/nodes/PrintIpp/PrintIpp.node.ts`

- [ ] **Step 1: Update `createMockExecuteFunctions` to handle `colorMode` and 4-arg `getNodeParameter`**

In `tests/Printer.node.test.ts`, update the `defaults` object in `createMockExecuteFunctions` — change `getNodeParameter` to include `colorMode`:

```typescript
getNodeParameter: (
  paramName: string,
  _itemIndex: number,
  fallback?: unknown,
) => {
  if (paramName === "printerName") return "TestPrinter";
  if (paramName === "binaryProperty") return "data";
  if (paramName === "copies") return 1;
  if (paramName === "sides") return "one-sided";
  if (paramName === "media") return "iso_a4_210x297mm";
  if (paramName === "colorMode") return "color";
  if (paramName === "advancedOptions") return fallback ?? {};
  return fallback ?? "";
},
```

- [ ] **Step 2: Update execute output assertions to include `print-color-mode`**

In the `"returns job fields from IPP response"` test (around line 186), update the `toEqual` assertion:

```typescript
expect(result[0][0].json).toEqual({
  "job-id": 42,
  "job-uri": "ipp://cupsd:631/jobs/42",
  "job-state": "pending",
  "job-state-reasons": "none",
  "status-code": "successful-ok",
  "print-color-mode": "color",
});
```

In the `"sends correct job-attributes-tag"` test (around line 245), update the `getNodeParameter` mock to include `colorMode` and add the assertion:

```typescript
const ctx = createMockExecuteFunctions({
  getNodeParameter: (param, _i, fallback) => {
    if (param === "printerName") return "PX-M6010F";
    if (param === "binaryProperty") return "data";
    if (param === "copies") return 3;
    if (param === "sides") return "two-sided-long-edge";
    if (param === "media") return "na_letter_8.5x11in";
    if (param === "colorMode") return "monochrome";
    if (param === "advancedOptions") return fallback ?? {};
    return fallback ?? "";
  },
});
```

And add to the assertion:

```typescript
expect(jobAttrs["print-color-mode"]).toBe("monochrome");
```

- [ ] **Step 3: Run tests to verify the execute assertions fail**

```bash
bun test 2>&1 | grep -E "returns job fields|job-attributes-tag|✗"
```

Expected: both updated execute tests fail.

- [ ] **Step 4: Update `execute` in `PrintIpp.node.ts`**

In the `this.execute` function, update the parameter reading section. Replace the existing `sides` and `media` lines and add `colorMode`:

```typescript
const sides = this.getNodeParameter(
  "sides",
  i,
  undefined,
  { extractValue: true },
) as string;
const media = this.getNodeParameter(
  "media",
  i,
  undefined,
  { extractValue: true },
) as string;
const colorMode = this.getNodeParameter(
  "colorMode",
  i,
  undefined,
  { extractValue: true },
) as string;
```

Update the IPP message `job-attributes-tag` to include `print-color-mode`:

```typescript
"job-attributes-tag": {
  copies,
  sides,
  media,
  "print-color-mode": colorMode,
},
```

Update the `returnData.push` to include `print-color-mode` in the output JSON:

```typescript
returnData.push({
  json: {
    "job-id": jobAttrs["job-id"],
    "job-uri": jobAttrs["job-uri"],
    "job-state": jobAttrs["job-state"],
    "job-state-reasons": jobAttrs["job-state-reasons"],
    "status-code": response.statusCode,
    "print-color-mode": colorMode,
  },
  pairedItem: { item: i },
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6: Run type check and lint**

```bash
bun run build && bun run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/nodes/PrintIpp/PrintIpp.node.ts tests/Printer.node.test.ts
git commit -m "feat: read colorMode in execute, send print-color-mode in IPP message and output"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/requirements.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `docs/requirements.md`**

In the **Parameters → Top-level** table, add the `Color Mode` row after `Media`:

```markdown
| Color Mode | `resourceLocator` | — | `color` | Color printing mode. Select from printer-supported modes or enter an IPP `print-color-mode` keyword manually. |
```

Update the `Sides` and `Media` rows to reflect the new type:

```markdown
| Sides | `resourceLocator` | — | `one-sided` | Duplex setting. Select from printer-supported values (loaded via `Get-Printer-Attributes`) or enter manually. Shows IPP General defaults when no printer selected. |
| Media | `resourceLocator` | — | `iso_a4_210x297mm` | IPP media keyword. Select from printer-supported sizes or enter manually. Shows IPP General defaults when no printer selected. |
```

Add an **IPP General Defaults** subsection after the **Sides options** table:

```markdown
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
```

Update the **IPP Message Structure** section to add `print-color-mode`:

```
job-attributes-tag:
  copies                ← Copies
  sides                 ← Sides (extracted from resourceLocator)
  media                 ← Media (extracted from resourceLocator)
  print-color-mode      ← Color Mode (extracted from resourceLocator)
```

Update the **Output Schema → Success** section:

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

Remove `Get-Printer-Attributes` from **Out of Scope** (it is now implemented).

Add a **Printer Attribute Discovery** subsection to the **Credential** section:

```markdown
### Printer Attribute Discovery

When a printer is selected in the Printer Name field, `Sides`, `Media`, and `Color Mode` load printer-specific supported values via `Get-Printer-Attributes` sent to `http://{host}:{port}/printers/{printerName}`. Requested attributes: `sides-supported`, `media-supported`, `print-color-mode-supported`.

On fetch failure (network error, printer offline), each field silently falls back to IPP General defaults — standard IPP/PWG keyword values labeled `(IPP General)` in the dropdown. A notice in the node panel informs the user to select a printer to load specific options.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the **IPP Message Structure** code block, update `job-attributes-tag`:

```
job-attributes-tag:
  copies: copies,
  sides,
  media,
  "print-color-mode": colorMode,
```

- [ ] **Step 3: Update `README.md`**

In the **Parameters** table, add `Color Mode` row after `Media`:

```markdown
| Color Mode | — | `color` | Color mode. Select from printer-supported values (loaded automatically) or type a value manually (e.g. `color`, `monochrome`). |
```

Update the `Sides` and `Media` rows:

```markdown
| Sides | — | `one-sided` | Duplex setting. Select from printer-supported values (loaded automatically when printer is selected) or type a value manually. |
| Media | — | `iso_a4_210x297mm` | IPP media keyword. Select from printer-supported sizes (loaded automatically) or type a keyword manually. |
```

Update the **Output → On success** JSON block:

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

- [ ] **Step 4: Commit**

```bash
git add docs/requirements.md CLAUDE.md README.md
git commit -m "docs: update requirements, CLAUDE.md, and README for dynamic printer attributes"
```

---

## Task 6: Merge spec into requirements and final verification

**Files:**
- Delete: `docs/drafts/20260426-dynamic-printer-attributes-design.md`
- Run: full build + test + lint

- [ ] **Step 1: Delete the draft spec (content merged into requirements.md in Task 5)**

```bash
git rm docs/drafts/20260426-dynamic-printer-attributes-design.md
git commit -m "chore: remove draft spec after merging into requirements.md"
```

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: all tests pass. Note the test count — should be higher than the 35 from the previous branch.

- [ ] **Step 3: Run build and lint**

```bash
bun run build && bun run lint
```

Expected: no errors, exit code 0.

- [ ] **Step 4: Verify dist output includes the new fields**

```bash
grep -c "getSidesOptions\|getMediaOptions\|getColorModeOptions\|print-color-mode" dist/nodes/PrintIpp/PrintIpp.node.js
```

Expected: count > 0 (confirming the bundled output contains the new methods and attribute name).

---

## Quick Reference: Key Exports After This Work

| Symbol | Type | Purpose |
|--------|------|---------|
| `PrinterAttributes` | interface | `{ sidesSupported, mediaSupported, colorModesSupported }` |
| `fetchPrinterAttributes` | function | Calls `Get-Printer-Attributes`, returns `PrinterAttributes \| null` |
| `SIDES_DEFAULTS` | const | Static IPP General fallback for sides |
| `MEDIA_DEFAULTS` | const | Static IPP General fallback for media |
| `COLOR_MODE_DEFAULTS` | const | Static IPP General fallback for color mode |
| `getSidesOptions` | listSearch method | Dynamic sides dropdown |
| `getMediaOptions` | listSearch method | Dynamic media dropdown |
| `getColorModeOptions` | listSearch method | Dynamic color mode dropdown |
