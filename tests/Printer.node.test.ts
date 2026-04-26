import { describe, expect, it } from "bun:test";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import type {
	IppPrinterFactory,
	IppResponse,
} from "../src/nodes/Printer/Printer.node";
import { Printer, testIppConnection } from "../src/nodes/Printer/Printer.node";

function makeIppFactory(
	handler: (
		url: string,
		operation: string,
		message: object,
	) => IppResponse | Error,
): IppPrinterFactory {
	return (url: string) => ({
		execute: (
			operation: string,
			message: object,
			callback: (err: Error | null, res: IppResponse) => void,
		) => {
			const result = handler(url, operation, message);
			if (result instanceof Error) {
				callback(result, {} as IppResponse);
			} else {
				callback(null, result);
			}
		},
	});
}

function successFactory(jobId = 42, jobState = "pending"): IppPrinterFactory {
	return makeIppFactory(() => ({
		statusCode: "successful-ok",
		"job-attributes-tag": {
			"job-id": jobId,
			"job-uri": `ipp://cupsd:631/jobs/${jobId}`,
			"job-state": jobState,
			"job-state-reasons": "none",
		},
	}));
}

function createMockExecuteFunctions(
	overrides: Partial<{
		getInputData: () => INodeExecutionData[];
		getNodeParameter: (
			paramName: string,
			itemIndex: number,
			fallback?: unknown,
		) => unknown;
		getCredentials: () => Promise<Record<string, unknown>>;
		getBinaryDataBuffer: (index: number, prop: string) => Promise<Buffer>;
		continueOnFail: () => boolean;
	}>,
): IExecuteFunctions {
	const defaults = {
		getInputData: () => [{ json: {} }] as INodeExecutionData[],
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
			if (paramName === "advancedOptions") return fallback ?? {};
			return fallback ?? "";
		},
		getCredentials: async () => ({
			host: "cupsd",
			port: 631,
			username: "n8n",
		}),
		getBinaryDataBuffer: async () => Buffer.from("PDF content"),
		continueOnFail: () => false,
	};

	const merged = { ...defaults, ...overrides };

	return {
		getInputData: merged.getInputData,
		getNodeParameter:
			merged.getNodeParameter as IExecuteFunctions["getNodeParameter"],
		getCredentials:
			merged.getCredentials as IExecuteFunctions["getCredentials"],
		getNode: () => ({
			name: "Printer",
			type: "printer",
			typeVersion: 1,
			position: [0, 0] as [number, number],
			id: "node-1",
			parameters: {},
		}),
		continueOnFail: merged.continueOnFail,
		helpers: {
			getBinaryDataBuffer:
				merged.getBinaryDataBuffer as IExecuteFunctions["helpers"]["getBinaryDataBuffer"],
		},
	} as unknown as IExecuteFunctions;
}

describe("Printer node description", () => {
	it("has correct name and display name", () => {
		const node = new Printer();
		expect(node.description.name).toBe("printer");
		expect(node.description.displayName).toBe("Printer (IPP) @a24k");
	});

	it("sets usableAsTool to true", () => {
		const node = new Printer();
		expect(node.description.usableAsTool).toBe(true);
	});

	it("uses ippApi credential", () => {
		const node = new Printer();
		const creds = node.description.credentials ?? [];
		expect(creds.some((c) => c.name === "ippApi")).toBe(true);
	});

	it("has required properties", () => {
		const node = new Printer();
		const names = node.description.properties.map((p) => p.name);
		expect(names).toContain("printerName");
		expect(names).toContain("binaryProperty");
		expect(names).toContain("copies");
		expect(names).toContain("sides");
		expect(names).toContain("media");
		expect(names).toContain("advancedOptions");
	});

	it("binaryProperty defaults to 'data'", () => {
		const node = new Printer();
		const prop = node.description.properties.find(
			(p) => p.name === "binaryProperty",
		);
		expect(prop?.default).toBe("data");
	});

	it("sides has correct options", () => {
		const node = new Printer();
		const prop = node.description.properties.find((p) => p.name === "sides");
		const values = (prop?.options as Array<{ value: string }> | undefined)?.map(
			(o) => o.value,
		);
		expect(values).toContain("one-sided");
		expect(values).toContain("two-sided-long-edge");
		expect(values).toContain("two-sided-short-edge");
	});

	it("advancedOptions contains jobName and documentFormat", () => {
		const node = new Printer();
		const prop = node.description.properties.find(
			(p) => p.name === "advancedOptions",
		);
		const optNames = (
			prop?.options as Array<{ name: string }> | undefined
		)?.map((o) => o.name);
		expect(optNames).toContain("jobName");
		expect(optNames).toContain("documentFormat");
	});
});

describe("Printer execute — successful print job", () => {
	it("returns job fields from IPP response", async () => {
		const ctx = createMockExecuteFunctions({});
		const node = new Printer(successFactory(42));
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json).toEqual({
			"job-id": 42,
			"job-uri": "ipp://cupsd:631/jobs/42",
			"job-state": "pending",
			"job-state-reasons": "none",
			"status-code": "successful-ok",
		});
	});

	it("builds printer URL from credentials", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 1, "job-state": "pending" },
			};
		});

		const ctx = createMockExecuteFunctions({
			getCredentials: async () => ({
				host: "myprinter",
				port: 9631,
				username: "n8n",
			}),
		});
		const node = new Printer(factory);
		await node.execute.call(ctx);

		expect(capturedUrls[0]).toBe("http://myprinter:9631/printers/TestPrinter");
	});

	it("sends correct operation-attributes-tag", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 1, "job-state": "pending" },
			};
		});

		const ctx = createMockExecuteFunctions({});
		const node = new Printer(factory);
		await node.execute.call(ctx);

		const msg = capturedMessages[0] as Record<string, unknown>;
		const opAttrs = msg["operation-attributes-tag"] as Record<string, unknown>;
		expect(opAttrs["requesting-user-name"]).toBe("n8n");
		expect(opAttrs["job-name"]).toBe("n8n print job");
		expect(opAttrs["document-format"]).toBe("application/pdf");
	});

	it("sends correct job-attributes-tag", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 1, "job-state": "pending" },
			};
		});

		const ctx = createMockExecuteFunctions({
			getNodeParameter: (param, _i, fallback) => {
				if (param === "printerName") return "PX-M6010F";
				if (param === "binaryProperty") return "data";
				if (param === "copies") return 3;
				if (param === "sides") return "two-sided-long-edge";
				if (param === "media") return "na_letter_8.5x11in";
				if (param === "advancedOptions") return fallback ?? {};
				return fallback ?? "";
			},
		});
		const node = new Printer(factory);
		await node.execute.call(ctx);

		const msg = capturedMessages[0] as Record<string, unknown>;
		const jobAttrs = msg["job-attributes-tag"] as Record<string, unknown>;
		expect(jobAttrs.copies).toBe(3);
		expect(jobAttrs.sides).toBe("two-sided-long-edge");
		expect(jobAttrs.media).toBe("na_letter_8.5x11in");
	});

	it("sends binary buffer as data", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 1, "job-state": "pending" },
			};
		});

		const pdfBytes = Buffer.from("%PDF-1.4 test content");
		const ctx = createMockExecuteFunctions({
			getBinaryDataBuffer: async () => pdfBytes,
		});
		const node = new Printer(factory);
		await node.execute.call(ctx);

		const msg = capturedMessages[0] as Record<string, unknown>;
		expect(msg.data).toEqual(pdfBytes);
	});

	it("uses custom jobName and documentFormat from advancedOptions", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 1, "job-state": "pending" },
			};
		});

		const ctx = createMockExecuteFunctions({
			getNodeParameter: (param, _i, fallback) => {
				if (param === "printerName") return "TestPrinter";
				if (param === "binaryProperty") return "data";
				if (param === "copies") return 1;
				if (param === "sides") return "one-sided";
				if (param === "media") return "iso_a4_210x297mm";
				if (param === "advancedOptions")
					return { jobName: "My Report", documentFormat: "image/pwg-raster" };
				return fallback ?? "";
			},
		});
		const node = new Printer(factory);
		await node.execute.call(ctx);

		const msg = capturedMessages[0] as Record<string, unknown>;
		const opAttrs = msg["operation-attributes-tag"] as Record<string, unknown>;
		expect(opAttrs["job-name"]).toBe("My Report");
		expect(opAttrs["document-format"]).toBe("image/pwg-raster");
	});

	it("uses the binaryProperty name from parameter", async () => {
		const requestedProps: string[] = [];
		const ctx = createMockExecuteFunctions({
			getNodeParameter: (param, _i, fallback) => {
				if (param === "printerName") return "TestPrinter";
				if (param === "binaryProperty") return "myPdf";
				if (param === "copies") return 1;
				if (param === "sides") return "one-sided";
				if (param === "media") return "iso_a4_210x297mm";
				if (param === "advancedOptions") return fallback ?? {};
				return fallback ?? "";
			},
			getBinaryDataBuffer: async (_i, prop) => {
				requestedProps.push(prop);
				return Buffer.from("PDF");
			},
		});
		const node = new Printer(successFactory());
		await node.execute.call(ctx);
		expect(requestedProps).toEqual(["myPdf"]);
	});

	it("processes multiple items independently", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": {
					"job-id": capturedUrls.length,
					"job-state": "pending",
				},
			};
		});

		const ctx = createMockExecuteFunctions({
			getInputData: () =>
				[{ json: { n: 1 } }, { json: { n: 2 } }] as INodeExecutionData[],
		});
		const node = new Printer(factory);
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(2);
		expect(capturedUrls).toHaveLength(2);
	});
});

describe("Printer execute — error handling", () => {
	it("rethrows when continueOnFail is false", async () => {
		const factory = makeIppFactory(() => new Error("IPP connection refused"));
		const ctx = createMockExecuteFunctions({ continueOnFail: () => false });
		const node = new Printer(factory);
		await expect(node.execute.call(ctx)).rejects.toThrow();
	});

	it("returns error json when continueOnFail is true", async () => {
		const factory = makeIppFactory(() => new Error("IPP connection refused"));
		const ctx = createMockExecuteFunctions({ continueOnFail: () => true });
		const node = new Printer(factory);
		const result = await node.execute.call(ctx);
		expect(result[0][0].json.error).toBe("IPP connection refused");
	});

	it("continues to next item on error when continueOnFail is true", async () => {
		let callCount = 0;
		const factory = makeIppFactory(() => {
			callCount++;
			if (callCount === 1) return new Error("First item failed");
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": { "job-id": 2, "job-state": "pending" },
			};
		});

		const ctx = createMockExecuteFunctions({
			continueOnFail: () => true,
			getInputData: () => [{ json: {} }, { json: {} }] as INodeExecutionData[],
		});
		const node = new Printer(factory);
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(2);
		expect(result[0][0].json.error).toBe("First item failed");
		expect(result[0][1].json["job-id"]).toBe(2);
	});
});

describe("Printer credentialTest wiring", () => {
	it("exposes ippCredentialTest in methods.credentialTest", () => {
		const node = new Printer();
		expect(typeof node.methods?.credentialTest?.ippCredentialTest).toBe(
			"function",
		);
	});
});

describe("testIppConnection", () => {
	it("sends CUPS-Get-Printers to root endpoint", async () => {
		const capturedUrls: string[] = [];
		const capturedOps: string[] = [];
		const factory = makeIppFactory((url, operation) => {
			capturedUrls.push(url);
			capturedOps.push(operation);
			return { statusCode: "successful-ok", "printer-attributes-tag": [] };
		});
		await testIppConnection("myprinter", 9631, "n8n", factory);
		expect(capturedUrls[0]).toBe("http://myprinter:9631/");
		expect(capturedOps[0]).toBe("CUPS-Get-Printers");
	});

	it("returns OK with 2 printers found", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{}, {}],
		}));
		const result = await testIppConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (2 printers found)");
	});

	it("returns OK with singular label for 1 printer (array)", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{}],
		}));
		const result = await testIppConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (1 printer found)");
	});

	it("returns OK with 1 printer when ipp returns object instead of array", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await testIppConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (1 printer found)");
	});

	it("returns Error with message when no printers found", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [],
		}));
		const result = await testIppConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("Error");
		expect(result.message).toBe("Connection failed: no printers found");
	});

	it("returns Error on connection failure", async () => {
		const factory = makeIppFactory(() => new Error("Connection refused"));
		const result = await testIppConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("Error");
		expect(result.message).toBe("Connection failed");
	});
});
