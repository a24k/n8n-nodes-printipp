import { describe, expect, it } from "bun:test";
import type {
	ICredentialTestFunctions,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
} from "n8n-workflow";
import { PrintIpp as PrintIppCredential } from "../src/credentials/PrintIpp.credentials";
import type {
	IppConnectionOptions,
	IppPrinterFactory,
	IppResponse,
} from "../src/nodes/PrintIpp/PrintIpp.node";
import {
	buildConnectionOptions,
	buildIppUrl,
	fetchCupsPrinters,
	fetchPrinterAttributes,
	PrintIpp,
	resolvePrinterPath,
	testCupsConnection,
	testIppConnection,
} from "../src/nodes/PrintIpp/PrintIpp.node";

function makeIppFactory(
	handler: (
		url: string,
		operation: string,
		message: object,
	) => IppResponse | Error,
): IppPrinterFactory {
	return (url: string, _options: IppConnectionOptions) => ({
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
			if (paramName === "colorMode") return "color";
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
			name: "PrintIPP",
			type: "printIpp",
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

describe("PrintIpp node description", () => {
	it("has correct name and display name", () => {
		const node = new PrintIpp();
		expect(node.description.name).toBe("printIpp");
		expect(node.description.displayName).toBe("PrintIPP @a24k");
	});

	it("sets usableAsTool to true", () => {
		const node = new PrintIpp();
		expect(node.description.usableAsTool).toBe(true);
	});

	it("uses printIpp credential", () => {
		const node = new PrintIpp();
		const creds = node.description.credentials ?? [];
		expect(creds.some((c) => c.name === "printIpp")).toBe(true);
	});

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

	it("printerName is resourceLocator with list and id modes", () => {
		const node = new PrintIpp();
		const prop = node.description.properties.find(
			(p) => p.name === "printerName",
		);
		expect(prop?.type).toBe("resourceLocator");
		const modes = prop?.modes ?? [];
		expect(modes.some((m) => m.name === "list")).toBe(true);
		expect(modes.some((m) => m.name === "id")).toBe(true);
	});

	it("binaryProperty defaults to 'data'", () => {
		const node = new PrintIpp();
		const prop = node.description.properties.find(
			(p) => p.name === "binaryProperty",
		);
		expect(prop?.default).toBe("data");
	});

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
		const prop = node.description.properties.find(
			(p) => p.name === "colorMode",
		);
		expect(prop?.type).toBe("resourceLocator");
		const modes = prop?.modes ?? [];
		expect(modes.some((m) => m.name === "list")).toBe(true);
		expect(modes.some((m) => m.name === "id")).toBe(true);
	});

	it("advancedOptions contains jobName and documentFormat", () => {
		const node = new PrintIpp();
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

describe("PrintIpp execute — successful print job", () => {
	it("returns job fields from IPP response", async () => {
		const ctx = createMockExecuteFunctions({});
		const node = new PrintIpp(successFactory(42));
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json).toEqual({
			"job-id": 42,
			"job-uri": "ipp://cupsd:631/jobs/42",
			"job-state": "pending",
			"job-state-reasons": "none",
			"status-code": "successful-ok",
			"print-color-mode": "color",
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
		const node = new PrintIpp(factory);
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
		const node = new PrintIpp(factory);
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
				if (param === "colorMode") return "monochrome";
				if (param === "advancedOptions") return fallback ?? {};
				return fallback ?? "";
			},
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);

		const msg = capturedMessages[0] as Record<string, unknown>;
		const jobAttrs = msg["job-attributes-tag"] as Record<string, unknown>;
		expect(jobAttrs.copies).toBe(3);
		expect(jobAttrs.sides).toBe("two-sided-long-edge");
		expect(jobAttrs.media).toBe("na_letter_8.5x11in");
		expect(jobAttrs["print-color-mode"]).toBe("monochrome");
		expect(jobAttrs.Ink).toBe("MONO");
	});

	it("sends Ink=COLOR when colorMode is color", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": {
					"job-id": 1,
					"job-uri": "",
					"job-state": "pending",
					"job-state-reasons": "none",
				},
			};
		});
		const ctx = createMockExecuteFunctions({});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);
		const jobAttrs = (capturedMessages[0] as Record<string, unknown>)[
			"job-attributes-tag"
		] as Record<string, unknown>;
		expect(jobAttrs["print-color-mode"]).toBe("color");
		expect(jobAttrs.Ink).toBe("COLOR");
	});

	it("does not send Ink for non-color/monochrome modes", async () => {
		const capturedMessages: object[] = [];
		const factory = makeIppFactory((_url, _op, message) => {
			capturedMessages.push(message);
			return {
				statusCode: "successful-ok",
				"job-attributes-tag": {
					"job-id": 1,
					"job-uri": "",
					"job-state": "pending",
					"job-state-reasons": "none",
				},
			};
		});
		const ctx = createMockExecuteFunctions({
			getNodeParameter: (param, _i, fallback) => {
				if (param === "printerName") return "TestPrinter";
				if (param === "binaryProperty") return "data";
				if (param === "copies") return 1;
				if (param === "sides") return "one-sided";
				if (param === "media") return "iso_a4_210x297mm";
				if (param === "colorMode") return "auto";
				if (param === "advancedOptions") return fallback ?? {};
				return fallback ?? "";
			},
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);
		const jobAttrs = (capturedMessages[0] as Record<string, unknown>)[
			"job-attributes-tag"
		] as Record<string, unknown>;
		expect(jobAttrs["print-color-mode"]).toBe("auto");
		expect(jobAttrs.Ink).toBeUndefined();
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
		const node = new PrintIpp(factory);
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
		const node = new PrintIpp(factory);
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
		const node = new PrintIpp(successFactory());
		await node.execute.call(ctx);
		expect(requestedProps).toEqual(["myPdf"]);
	});

	it("builds https URL with Basic Auth when credentials specify them", async () => {
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
				username: "admin",
				protocol: "https",
				password: "s3cr3t",
				skipCertValidation: false,
			}),
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);

		expect(capturedUrls[0]).toBe(
			"https://admin:s3cr3t@myprinter:9631/printers/TestPrinter",
		);
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
		const node = new PrintIpp(factory);
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(2);
		expect(capturedUrls).toHaveLength(2);
	});
});

describe("PrintIpp execute — error handling", () => {
	it("rethrows when continueOnFail is false", async () => {
		const factory = makeIppFactory(() => new Error("IPP connection refused"));
		const ctx = createMockExecuteFunctions({ continueOnFail: () => false });
		const node = new PrintIpp(factory);
		await expect(node.execute.call(ctx)).rejects.toThrow();
	});

	it("returns error json when continueOnFail is true", async () => {
		const factory = makeIppFactory(() => new Error("IPP connection refused"));
		const ctx = createMockExecuteFunctions({ continueOnFail: () => true });
		const node = new PrintIpp(factory);
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
		const node = new PrintIpp(factory);
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(2);
		expect(result[0][0].json.error).toBe("First item failed");
		expect(result[0][1].json["job-id"]).toBe(2);
	});
});

describe("PrintIpp credentialTest wiring", () => {
	it("exposes printIppCredentialTest in methods.credentialTest", () => {
		const node = new PrintIpp();
		expect(typeof node.methods?.credentialTest?.printIppCredentialTest).toBe(
			"function",
		);
	});
});

describe("testCupsConnection (CUPS-specific credential test)", () => {
	it("sends CUPS-Get-Printers to root endpoint", async () => {
		const capturedUrls: string[] = [];
		const capturedOps: string[] = [];
		const factory = makeIppFactory((url, operation) => {
			capturedUrls.push(url);
			capturedOps.push(operation);
			return { statusCode: "successful-ok", "printer-attributes-tag": [] };
		});
		await testCupsConnection("myprinter", 9631, "n8n", factory);
		expect(capturedUrls[0]).toBe("http://myprinter:9631/");
		expect(capturedOps[0]).toBe("CUPS-Get-Printers");
	});

	it("returns cert error message when error message contains CERT", async () => {
		const factory = makeIppFactory(
			() => new Error("SELF_SIGNED_CERT_IN_CHAIN"),
		);
		const result = await testCupsConnection(
			"cupsd",
			631,
			"n8n",
			factory,
			"https",
			"",
			false,
		);
		expect(result.status).toBe("Error");
		expect(result.message).toBe(
			"Connection failed: certificate validation error",
		);
	});

	it("returns OK with 2 printers found", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{}, {}],
		}));
		const result = await testCupsConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (2 printers found)");
	});

	it("returns OK with singular label for 1 printer (array)", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{}],
		}));
		const result = await testCupsConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (1 printer found)");
	});

	it("returns OK with 1 printer when ipp returns object instead of array", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await testCupsConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected successfully (1 printer found)");
	});

	it("returns Error with message when no printers found", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [],
		}));
		const result = await testCupsConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("Error");
		expect(result.message).toContain("Connection failed: no printers found");
	});

	it("returns Error on connection failure", async () => {
		const factory = makeIppFactory(() => new Error("Connection refused"));
		const result = await testCupsConnection("cupsd", 631, "n8n", factory);
		expect(result.status).toBe("Error");
		expect(result.message).toBe("Connection failed");
	});
});

describe("fetchCupsPrinters", () => {
	it("uses https URL when protocol is https", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return { statusCode: "successful-ok", "printer-attributes-tag": [] };
		});
		await fetchCupsPrinters("cupsd", 631, "n8n", factory, "https", "", false);
		expect(capturedUrls[0]).toBe("https://cupsd:631/");
	});

	it("embeds Basic Auth when password is set", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return { statusCode: "successful-ok", "printer-attributes-tag": [] };
		});
		await fetchCupsPrinters(
			"cupsd",
			631,
			"admin",
			factory,
			"https",
			"s3cr3t",
			false,
		);
		expect(capturedUrls[0]).toBe("https://admin:s3cr3t@cupsd:631/");
	});

	it("maps printer-name and printer-info from attrs", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [
				{ "printer-name": "Office-Laser", "printer-info": "3rd Floor Printer" },
				{ "printer-name": "MyPrinter" },
			],
		}));
		const result = await fetchCupsPrinters("cupsd", 631, "n8n", factory);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			name: "Office-Laser",
			info: "3rd Floor Printer",
		});
		expect(result[1]).toEqual({ name: "MyPrinter", info: undefined });
	});

	it("returns empty array when printer-attributes-tag is absent", async () => {
		const factory = makeIppFactory(() => ({ statusCode: "successful-ok" }));
		const result = await fetchCupsPrinters("cupsd", 631, "n8n", factory);
		expect(result).toEqual([]);
	});

	it("wraps single object response in array", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"printer-name": "solo",
			} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await fetchCupsPrinters("cupsd", 631, "n8n", factory);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("solo");
	});
});

function createMockLoadOptionsFunctions(
	credentialsOverride?: Partial<{
		host: string;
		port: number;
		username: string;
		connectionType: string;
		protocol: string;
		password: string;
		skipCertValidation: boolean;
		printerPath: string;
	}>,
	currentNodeParams?: Record<string, unknown>,
): ILoadOptionsFunctions {
	const credentials = {
		host: "cupsd",
		port: 631,
		username: "n8n",
		connectionType: "cups",
		protocol: "http",
		password: "",
		skipCertValidation: false,
		...credentialsOverride,
	};
	const nodeParams = currentNodeParams ?? {};
	return {
		getCredentials: async (_name: string) => credentials,
		getCurrentNodeParameter: (name: string) => nodeParams[name] ?? "",
	} as unknown as ILoadOptionsFunctions;
}

function getCupsPrinters(node: PrintIpp) {
	const fn = node.methods?.listSearch?.getCupsPrinters;
	if (!fn) throw new Error("getCupsPrinters not found");
	return fn;
}

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

describe("listSearch.getCupsPrinters", () => {
	it("returns mapped results from CUPS", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [
				{ "printer-name": "Office-Laser", "printer-info": "3rd Floor" },
				{ "printer-name": "MyPrinter" },
			],
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions();
		const result = await getCupsPrinters(node).call(ctx);
		expect(result.results).toHaveLength(2);
		expect(result.results[0]).toEqual({
			name: "Office-Laser (3rd Floor)",
			value: "Office-Laser",
		});
		expect(result.results[1]).toEqual({
			name: "MyPrinter",
			value: "MyPrinter",
		});
	});

	it("filters results by printer name (case-insensitive)", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [
				{ "printer-name": "Office-Laser" },
				{ "printer-name": "MyPrinter" },
				{ "printer-name": "office-color" },
			],
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions();
		const result = await getCupsPrinters(node).call(ctx, "office");
		expect(result.results).toHaveLength(2);
		expect(result.results.map((r) => r.value)).toEqual([
			"Office-Laser",
			"office-color",
		]);
	});

	it("filters results by printer-info", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [
				{ "printer-name": "LP1", "printer-info": "3rd Floor Color" },
				{ "printer-name": "LP2", "printer-info": "Basement B&W" },
			],
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions();
		const result = await getCupsPrinters(node).call(ctx, "color");
		expect(result.results).toHaveLength(1);
		expect(result.results[0].value).toBe("LP1");
	});

	it("returns empty results when connectionType is not cups", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{ "printer-name": "LP1" }],
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions({ connectionType: "direct" });
		const result = await getCupsPrinters(node).call(ctx);
		expect(result.results).toEqual([]);
	});

	it("reads credentials using the printIpp credential name", async () => {
		const capturedNames: string[] = [];
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [],
		}));
		const node = new PrintIpp(factory);
		const ctx = {
			getCredentials: async (name: string) => {
				capturedNames.push(name);
				return {
					host: "cupsd",
					port: 631,
					username: "n8n",
					connectionType: "cups",
				};
			},
		} as unknown as ILoadOptionsFunctions;
		await getCupsPrinters(node).call(ctx);
		expect(capturedNames).toEqual(["printIpp"]);
	});
});

describe("listSearch.getSidesOptions", () => {
	it("returns IPP General defaults when printerName is empty", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getSidesOptions(node).call(ctx);
		expect(result.results).toHaveLength(3);
		expect(result.results[0]).toEqual({
			name: "One-Sided (IPP General)",
			value: "one-sided",
		});
		expect(result.results[1]).toEqual({
			name: "Two-Sided Long Edge (IPP General)",
			value: "two-sided-long-edge",
		});
		expect(result.results[2]).toEqual({
			name: "Two-Sided Short Edge (IPP General)",
			value: "two-sided-short-edge",
		});
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
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getSidesOptions(node).call(ctx);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({
			name: "One-Sided",
			value: "one-sided",
		});
	});

	it("falls back to IPP General defaults when fetch fails", async () => {
		const factory = makeIppFactory(() => new Error("Printer offline"));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
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
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getSidesOptions(node).call(ctx);
		expect(result.results).toHaveLength(3);
	});

	it("filters results by name (case-insensitive)", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getSidesOptions(node).call(ctx, "two-sided");
		expect(result.results).toHaveLength(2);
		expect(result.results.every((r) => r.value.includes("two-sided"))).toBe(
			true,
		);
	});
});

describe("listSearch.getMediaOptions", () => {
	it("returns IPP General defaults when printerName is empty", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(4);
		expect(result.results[0]).toEqual({
			name: "A4 (IPP General)",
			value: "iso_a4_210x297mm",
		});
		expect(result.results[1]).toEqual({
			name: "US Letter (IPP General)",
			value: "na_letter_8.5x11in",
		});
		expect(result.results[2]).toEqual({
			name: "A3 (IPP General)",
			value: "iso_a3_297x420mm",
		});
		expect(result.results[3]).toEqual({
			name: "US Legal (IPP General)",
			value: "na_legal_8.5x14in",
		});
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
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(2);
		expect(result.results[0]).toEqual({
			name: "A4",
			value: "iso_a4_210x297mm",
		});
		expect(result.results[1]).toEqual({
			name: "A3",
			value: "iso_a3_297x420mm",
		});
	});

	it("renders custom sizes as Custom (<dimensions>)", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"sides-supported": [],
				"media-supported": ["custom_328.93x482.94mm_328.93x482.94mm"],
				"print-color-mode-supported": [],
			} as unknown as Array<Record<string, unknown>>,
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({
			name: "Custom (328.93x482.94mm)",
			value: "custom_328.93x482.94mm_328.93x482.94mm",
		});
	});

	it("falls back to IPP General defaults when fetch fails", async () => {
		const factory = makeIppFactory(() => new Error("Printer offline"));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(4);
	});

	it("falls back to IPP General defaults when printer returns empty media-supported", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"sides-supported": [],
				"media-supported": [],
				"print-color-mode-supported": [],
			} as unknown as Array<Record<string, unknown>>,
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(4);
	});

	it("filters results by name (case-insensitive)", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getMediaOptions(node).call(ctx, "letter");
		expect(result.results).toHaveLength(1);
		expect(result.results[0].value).toBe("na_letter_8.5x11in");
	});
});

describe("listSearch.getColorModeOptions", () => {
	it("returns IPP General defaults when printerName is empty", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getColorModeOptions(node).call(ctx);
		expect(result.results).toHaveLength(3);
		expect(result.results[0]).toEqual({
			name: "Color (IPP General)",
			value: "color",
		});
		expect(result.results[1]).toEqual({
			name: "Monochrome (IPP General)",
			value: "monochrome",
		});
		expect(result.results[2]).toEqual({
			name: "Auto (IPP General)",
			value: "auto",
		});
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
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getColorModeOptions(node).call(ctx);
		expect(result.results).toHaveLength(2);
		expect(result.results[0]).toEqual({ name: "Color", value: "color" });
		expect(result.results[1]).toEqual({
			name: "Monochrome",
			value: "monochrome",
		});
	});

	it("falls back to IPP General defaults when fetch fails", async () => {
		const factory = makeIppFactory(() => new Error("Printer offline"));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getColorModeOptions(node).call(ctx);
		expect(result.results).toHaveLength(3);
	});

	it("falls back to IPP General defaults when printer returns empty color-modes", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"sides-supported": [],
				"media-supported": [],
				"print-color-mode-supported": [],
			} as unknown as Array<Record<string, unknown>>,
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(undefined, {
			printerName: "MyPrinter",
		});
		const result = await getColorModeOptions(node).call(ctx);
		expect(result.results).toHaveLength(3);
	});

	it("filters results by name (case-insensitive)", async () => {
		const node = new PrintIpp(
			makeIppFactory(() => ({ statusCode: "successful-ok" })),
		);
		const ctx = createMockLoadOptionsFunctions(undefined, { printerName: "" });
		const result = await getColorModeOptions(node).call(ctx, "mono");
		expect(result.results).toHaveLength(1);
		expect(result.results[0].value).toBe("monochrome");
	});
});

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
		await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
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
		const result = await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
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
		const result = await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
		expect(result?.sidesSupported).toEqual(["one-sided"]);
		expect(result?.mediaSupported).toEqual(["iso_a4_210x297mm"]);
		expect(result?.colorModesSupported).toEqual(["color"]);
	});

	it("returns null on network error", async () => {
		const factory = makeIppFactory(() => new Error("Connection refused"));
		const result = await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
		expect(result).toBeNull();
	});

	it("returns empty arrays for missing attributes", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
		expect(result?.sidesSupported).toEqual([]);
		expect(result?.mediaSupported).toEqual([]);
		expect(result?.colorModesSupported).toEqual([]);
	});

	it("returns null when printer-attributes-tag is absent", async () => {
		const factory = makeIppFactory(() => ({ statusCode: "successful-ok" }));
		const result = await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
		);
		expect(result).toBeNull();
	});

	it("uses https URL when protocol is https", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {} as unknown as Array<
					Record<string, unknown>
				>,
			};
		});
		await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
			"https",
			"",
			false,
		);
		expect(capturedUrls[0]).toBe("https://cupsd:631/printers/MyPrinter");
	});

	it("embeds Basic Auth in URL when password is set", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {} as unknown as Array<
					Record<string, unknown>
				>,
			};
		});
		await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"admin",
			factory,
			"https",
			"s3cr3t",
			false,
		);
		expect(capturedUrls[0]).toBe(
			"https://admin:s3cr3t@cupsd:631/printers/MyPrinter",
		);
	});

	it("passes rejectUnauthorized false when skipCertValidation is true", async () => {
		const capturedOptions: IppConnectionOptions[] = [];
		const factory: IppPrinterFactory = (_url, options) => {
			capturedOptions.push(options);
			return {
				execute: (_op, _msg, cb) =>
					cb(null, {
						statusCode: "successful-ok",
						"printer-attributes-tag": {} as unknown as Array<
							Record<string, unknown>
						>,
					}),
			};
		};
		await fetchPrinterAttributes(
			"cupsd",
			631,
			"/printers/MyPrinter",
			"n8n",
			factory,
			"https",
			"",
			true,
		);
		expect(capturedOptions[0]).toEqual({ rejectUnauthorized: false });
	});
});

describe("buildIppUrl", () => {
	it("returns http URL without auth when no password", () => {
		expect(buildIppUrl("http", "cupsd", 631, "/printers/LP1", "n8n", "")).toBe(
			"http://cupsd:631/printers/LP1",
		);
	});

	it("returns https URL without auth when no password", () => {
		expect(buildIppUrl("https", "cupsd", 631, "/printers/LP1", "n8n", "")).toBe(
			"https://cupsd:631/printers/LP1",
		);
	});

	it("embeds Basic Auth when password is provided", () => {
		expect(
			buildIppUrl("https", "cupsd", 631, "/printers/LP1", "admin", "s3cr3t"),
		).toBe("https://admin:s3cr3t@cupsd:631/printers/LP1");
	});

	it("percent-encodes special characters in username and password", () => {
		expect(
			buildIppUrl("https", "cupsd", 631, "/", "user@domain", "p@ss:word"),
		).toBe("https://user%40domain:p%40ss%3Aword@cupsd:631/");
	});
});

describe("buildConnectionOptions", () => {
	it("returns rejectUnauthorized true when skipCertValidation is false", () => {
		expect(buildConnectionOptions(false)).toEqual({ rejectUnauthorized: true });
	});

	it("returns rejectUnauthorized false when skipCertValidation is true", () => {
		expect(buildConnectionOptions(true)).toEqual({ rejectUnauthorized: false });
	});
});

describe("IppPrinterFactory options plumbing", () => {
	it("passes IppConnectionOptions to the factory", async () => {
		const capturedOptions: unknown[] = [];
		const factory: IppPrinterFactory = (_url, options) => {
			capturedOptions.push(options);
			return {
				execute: (_op, _msg, cb) =>
					cb(null, {
						statusCode: "successful-ok",
						"printer-attributes-tag": [],
					}),
			};
		};
		await fetchCupsPrinters("cupsd", 631, "n8n", factory);
		expect(capturedOptions[0]).toEqual({ rejectUnauthorized: true });
	});
});

describe("PrintIpp credential fields", () => {
	it("has protocol field defaulting to http", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "protocol");
		expect(field).toBeDefined();
		expect(field?.default).toBe("http");
	});

	it("has password field of type string", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "password");
		expect(field).toBeDefined();
		expect(field?.type).toBe("string");
	});

	it("has skipCertValidation field defaulting to false", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "skipCertValidation");
		expect(field).toBeDefined();
		expect(field?.default).toBe(false);
	});

	it("skipCertValidation only shows when protocol is https", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "skipCertValidation");
		const showCondition = field?.displayOptions?.show?.protocol;
		expect(showCondition).toEqual(["https"]);
	});

	it("connectionType has both cups and ipp options", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "connectionType");
		const values = (
			field?.options as Array<{ value: string }> | undefined
		)?.map((o) => o.value);
		expect(values).toContain("cups");
		expect(values).toContain("ipp");
	});

	it("has printerPath field defaulting to /ipp/print", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "printerPath");
		expect(field).toBeDefined();
		expect(field?.default).toBe("/ipp/print");
	});

	it("printerPath only shows when connectionType is ipp", () => {
		const cred = new PrintIppCredential();
		const field = cred.properties.find((p) => p.name === "printerPath");
		const showCondition = field?.displayOptions?.show?.connectionType;
		expect(showCondition).toEqual(["ipp"]);
	});
});

describe("resolvePrinterPath", () => {
	it("returns /printers/{name} for cups", () => {
		expect(resolvePrinterPath("cups", "MyPrinter", undefined)).toBe(
			"/printers/MyPrinter",
		);
	});

	it("throws when cups and printerName is empty", () => {
		expect(() => resolvePrinterPath("cups", "", undefined)).toThrow(
			"Printer Name is required when Connection Type is CUPS Server",
		);
	});

	it("throws when cups and printerName is undefined", () => {
		expect(() => resolvePrinterPath("cups", undefined, undefined)).toThrow();
	});

	it("returns printerPath for ipp", () => {
		expect(resolvePrinterPath("ipp", undefined, "/ipp/print")).toBe(
			"/ipp/print",
		);
	});

	it("ignores printerName in ipp mode", () => {
		expect(resolvePrinterPath("ipp", "Ignored", "/ipp/printer")).toBe(
			"/ipp/printer",
		);
	});

	it("defaults to /ipp/print when printerPath is empty", () => {
		expect(resolvePrinterPath("ipp", undefined, "")).toBe("/ipp/print");
	});

	it("defaults to /ipp/print when printerPath is undefined", () => {
		expect(resolvePrinterPath("ipp", undefined, undefined)).toBe("/ipp/print");
	});

	it("normalizes printerPath without leading slash", () => {
		expect(resolvePrinterPath("ipp", undefined, "ipp/print")).toBe(
			"/ipp/print",
		);
	});

	it("throws for unknown connectionType", () => {
		expect(() => resolvePrinterPath("unknown", undefined, undefined)).toThrow(
			"Unsupported connection type: unknown",
		);
	});
});

describe("testIppConnection", () => {
	it("returns OK with printer-state when printer responds", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"printer-state": "idle",
			} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await testIppConnection(
			"myprinter",
			631,
			"/ipp/print",
			"n8n",
			factory,
		);
		expect(result.status).toBe("OK");
		expect(result.message).toContain("idle");
	});

	it("returns OK with warning when printer-state is stopped", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": {
				"printer-state": "stopped",
			} as unknown as Array<Record<string, unknown>>,
		}));
		const result = await testIppConnection(
			"myprinter",
			631,
			"/ipp/print",
			"n8n",
			factory,
		);
		expect(result.status).toBe("OK");
		expect(result.message).toBe("Connected, but printer state is 'stopped'");
	});

	it("returns Error when printer-attributes-tag is absent", async () => {
		const factory = makeIppFactory(() => ({ statusCode: "successful-ok" }));
		const result = await testIppConnection(
			"myprinter",
			631,
			"/ipp/print",
			"n8n",
			factory,
		);
		expect(result.status).toBe("Error");
		expect(result.message).toBe(
			"Connection failed: no printer attributes returned",
		);
	});

	it("returns cert error when error message contains CERT", async () => {
		const factory = makeIppFactory(
			() => new Error("SELF_SIGNED_CERT_IN_CHAIN"),
		);
		const result = await testIppConnection(
			"myprinter",
			631,
			"/ipp/print",
			"n8n",
			factory,
			"https",
		);
		expect(result.status).toBe("Error");
		expect(result.message).toBe(
			"Connection failed: certificate validation error",
		);
	});

	it("returns generic error on connection failure", async () => {
		const factory = makeIppFactory(() => new Error("Connection refused"));
		const result = await testIppConnection(
			"myprinter",
			631,
			"/ipp/print",
			"n8n",
			factory,
		);
		expect(result.status).toBe("Error");
		expect(result.message).toBe("Connection failed");
	});

	it("sends Get-Printer-Attributes to the configured path", async () => {
		const capturedUrls: string[] = [];
		const capturedOps: string[] = [];
		const factory = makeIppFactory((url, op) => {
			capturedUrls.push(url);
			capturedOps.push(op);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {
					"printer-state": "idle",
				} as unknown as Array<Record<string, unknown>>,
			};
		});
		await testIppConnection("myprinter", 631, "/ipp/print", "n8n", factory);
		expect(capturedUrls[0]).toBe("http://myprinter:631/ipp/print");
		expect(capturedOps[0]).toBe("Get-Printer-Attributes");
	});
});

describe("PrintIpp execute — Direct IPP mode", () => {
	it("uses printerPath from credentials, not printerName", async () => {
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
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				printerPath: "/ipp/print",
			}),
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);

		expect(capturedUrls[0]).toBe("http://myprinter:631/ipp/print");
		expect(capturedUrls[0]).not.toContain("/printers/");
	});

	it("uses custom printerPath from credentials", async () => {
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
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				printerPath: "/ipp/printer",
			}),
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);

		expect(capturedUrls[0]).toBe("http://myprinter:631/ipp/printer");
	});

	it("ignores printerName node parameter in ipp mode", async () => {
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
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				printerPath: "/ipp/print",
			}),
		});
		const node = new PrintIpp(factory);
		await node.execute.call(ctx);

		// printerName "TestPrinter" from default mock is ignored
		expect(capturedUrls[0]).not.toContain("TestPrinter");
		expect(capturedUrls[0]).not.toContain("/printers/");
	});

	it("returns same output schema as CUPS mode", async () => {
		const ctx = createMockExecuteFunctions({
			getCredentials: async () => ({
				host: "myprinter",
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				printerPath: "/ipp/print",
			}),
		});
		const node = new PrintIpp(successFactory(99));
		const result = await node.execute.call(ctx);

		expect(result[0][0].json).toMatchObject({
			"job-id": 99,
			"status-code": "successful-ok",
		});
	});
});

describe("PrintIpp credential test — ipp routing", () => {
	it("calls testIppConnection for ipp connectionType", async () => {
		const capturedOps: string[] = [];
		const factory = makeIppFactory((_url, op) => {
			capturedOps.push(op);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {
					"printer-state": "idle",
				} as unknown as Array<Record<string, unknown>>,
			};
		});
		const node = new PrintIpp(factory);
		const fn = node.methods?.credentialTest?.printIppCredentialTest;
		if (!fn) throw new Error("printIppCredentialTest not found");
		const result = await fn.call({} as ICredentialTestFunctions, {
			id: "1",
			name: "test",
			type: "printIpp",
			data: {
				host: "myprinter",
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				printerPath: "/ipp/print",
				protocol: "http",
				password: "",
				skipCertValidation: false,
			},
		});
		expect(result.status).toBe("OK");
		expect(capturedOps[0]).toBe("Get-Printer-Attributes");
	});

	it("uses default /ipp/print when printerPath is not set", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {
					"printer-state": "idle",
				} as unknown as Array<Record<string, unknown>>,
			};
		});
		const node = new PrintIpp(factory);
		const fn = node.methods?.credentialTest?.printIppCredentialTest;
		if (!fn) throw new Error("printIppCredentialTest not found");
		await fn.call({} as ICredentialTestFunctions, {
			id: "1",
			name: "test",
			type: "printIpp",
			data: {
				host: "myprinter",
				port: 631,
				username: "n8n",
				connectionType: "ipp",
				protocol: "http",
				password: "",
				skipCertValidation: false,
			},
		});
		expect(capturedUrls[0]).toBe("http://myprinter:631/ipp/print");
	});
});

describe("listSearch Direct IPP mode", () => {
	it("getSidesOptions fetches from printerPath endpoint when connectionType is ipp", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {
					"sides-supported": ["one-sided", "two-sided-long-edge"],
					"media-supported": [],
					"print-color-mode-supported": [],
				} as unknown as Array<Record<string, unknown>>,
			};
		});
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(
			{ connectionType: "ipp", printerPath: "/ipp/print" },
			{},
		);
		const result = await getSidesOptions(node).call(ctx);
		expect(capturedUrls[0]).toBe("http://cupsd:631/ipp/print");
		expect(result.results).toHaveLength(2);
		expect(result.results[0].value).toBe("one-sided");
	});

	it("getMediaOptions falls back to defaults when ipp endpoint fails", async () => {
		const factory = makeIppFactory(() => new Error("Printer offline"));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(
			{ connectionType: "ipp", printerPath: "/ipp/print" },
			{},
		);
		const result = await getMediaOptions(node).call(ctx);
		expect(result.results).toHaveLength(4);
		expect(result.results[0].value).toBe("iso_a4_210x297mm");
	});

	it("getColorModeOptions does not use printerName node param in ipp mode", async () => {
		const capturedUrls: string[] = [];
		const factory = makeIppFactory((url) => {
			capturedUrls.push(url);
			return {
				statusCode: "successful-ok",
				"printer-attributes-tag": {
					"sides-supported": [],
					"media-supported": [],
					"print-color-mode-supported": ["color"],
				} as unknown as Array<Record<string, unknown>>,
			};
		});
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions(
			{ connectionType: "ipp", printerPath: "/ipp/print" },
			{ printerName: "ShouldBeIgnored" },
		);
		const result = await getColorModeOptions(node).call(ctx);
		// URL should NOT contain /printers/ShouldBeIgnored
		expect(capturedUrls[0]).not.toContain("ShouldBeIgnored");
		expect(capturedUrls[0]).toContain("/ipp/print");
		expect(result.results).toHaveLength(1);
	});

	it("getCupsPrinters returns empty when connectionType is ipp", async () => {
		const factory = makeIppFactory(() => ({
			statusCode: "successful-ok",
			"printer-attributes-tag": [{ "printer-name": "LP1" }],
		}));
		const node = new PrintIpp(factory);
		const ctx = createMockLoadOptionsFunctions({ connectionType: "ipp" });
		const result = await getCupsPrinters(node).call(ctx);
		expect(result.results).toEqual([]);
	});
});
