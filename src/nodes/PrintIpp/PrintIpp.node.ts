import { Printer as IppPrinter, operations as ippOperations } from "ipp";

// CUPS-Get-Printers (0x4002) is a CUPS extension not included in the ipp package's
// standard operations table. Add it so the serializer writes the correct op code.
ippOperations["CUPS-Get-Printers"] = 0x4002;

import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

export interface IppResponse {
	statusCode?: string;
	"job-attributes-tag"?: {
		"job-id"?: number;
		"job-uri"?: string;
		"job-state"?: string;
		"job-state-reasons"?: string;
	};
	"printer-attributes-tag"?:
		| Array<Record<string, unknown>>
		| Record<string, unknown>;
}

export interface IppPrinterInstance {
	execute(
		operation: string | number,
		message: object,
		callback: (err: Error | null, res: IppResponse) => void,
	): void;
}

export type IppPrinterFactory = (url: string) => IppPrinterInstance;

const defaultPrinterFactory: IppPrinterFactory = (url) =>
	IppPrinter(url) as unknown as IppPrinterInstance;

export interface CupsPrinterEntry {
	name: string;
	info?: string;
}

export interface PrinterAttributes {
	sidesSupported: string[];
	mediaSupported: string[];
	colorModesSupported: string[];
}

function toStringArray(val: unknown): string[] {
	if (Array.isArray(val))
		return (val as unknown[]).filter((v): v is string => typeof v === "string");
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

export async function fetchCupsPrinters(
	host: string,
	port: number,
	username: string,
	printerFactory: IppPrinterFactory = defaultPrinterFactory,
): Promise<CupsPrinterEntry[]> {
	const cupsUrl = `http://${host}:${port}/`;
	const printer = printerFactory(cupsUrl);
	const response = await new Promise<IppResponse>((resolve, reject) => {
		printer.execute(
			"CUPS-Get-Printers",
			{
				"operation-attributes-tag": {
					"requesting-user-name": username,
				},
			},
			(err, res) => {
				if (err) reject(err);
				else resolve(res);
			},
		);
	});

	const printerAttrs = response["printer-attributes-tag"];
	if (!printerAttrs) return [];

	const attrList: Array<Record<string, unknown>> = Array.isArray(printerAttrs)
		? printerAttrs
		: [printerAttrs as unknown as Record<string, unknown>];

	return attrList.map((attrs) => ({
		name: attrs["printer-name"] as string,
		info: attrs["printer-info"] as string | undefined,
	}));
}

export async function testCupsConnection(
	host: string,
	port: number,
	username: string,
	printerFactory: IppPrinterFactory = defaultPrinterFactory,
): Promise<INodeCredentialTestResult> {
	try {
		const printers = await fetchCupsPrinters(
			host,
			port,
			username,
			printerFactory,
		);
		const count = printers.length;
		if (count === 0) {
			return {
				status: "Error",
				message: "Connection failed: no printers found",
			};
		}
		return {
			status: "OK",
			message: `Connected successfully (${count} ${count === 1 ? "printer" : "printers"} found)`,
		};
	} catch {
		return {
			status: "Error",
			message: "Connection failed",
		};
	}
}

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

const SIDES_LABELS: Record<string, string> = {
	"one-sided": "One-Sided",
	"two-sided-long-edge": "Two-Sided Long Edge",
	"two-sided-short-edge": "Two-Sided Short Edge",
};

const MEDIA_LABELS: Record<string, string> = {
	iso_a4_210x297mm: "A4",
	"na_letter_8.5x11in": "US Letter",
	iso_a3_297x420mm: "A3",
	"na_legal_8.5x14in": "US Legal",
	iso_a5_148x210mm: "A5",
	iso_a6_105x148mm: "A6",
	"na_executive_7.25x10.5in": "Executive",
	na_ledger_11x17in: "Ledger (11×17)",
	na_tabloid_11x17in: "Tabloid (11×17)",
	jis_b4_257x364mm: "JIS B4",
	jis_b5_182x257mm: "JIS B5",
	om_postcard_100x148mm: "Postcard (100×148mm)",
	na_4x6_4x6in: "4×6 Photo",
	na_5x7_5x7in: "5×7 Photo",
	jpn_hagaki_100x148mm: "Hagaki (100×148mm)",
	jpn_you4_105x235mm: "You4 Envelope (105×235mm)",
	"oe_photo-l_3.5x5in": "Photo L (3.5×5in)",
	"na_index-4x6_4x6in": "Index Card (4×6in)",
	"na_govt-letter_8x10in": "Government Letter (8×10in)",
	"oe_photo-10r_10x12in": "Photo 10R (10×12in)",
};

function labelMedia(v: string): string {
	if (MEDIA_LABELS[v]) return MEDIA_LABELS[v];
	// custom_<W>x<H><unit>_<W>x<H><unit> → "Custom (<W>x<H><unit>)"
	const customMatch = /^custom_(\S+?)_\S+$/.exec(v);
	if (customMatch) return `Custom (${customMatch[1]})`;
	return v;
}

const COLOR_MODE_LABELS: Record<string, string> = {
	color: "Color",
	monochrome: "Monochrome",
	auto: "Auto",
	"auto-monochrome": "Auto (Monochrome)",
	"process-monochrome": "Process Monochrome",
	"bi-level": "Bi-Level",
};

async function listPrinterAttribute(
	ctx: ILoadOptionsFunctions,
	attrKey: keyof PrinterAttributes,
	defaults: Array<{ name: string; value: string }>,
	labeler: (v: string) => string,
	filter: string | undefined,
	printerFactory: IppPrinterFactory,
): Promise<INodeListSearchResult> {
	const credentials = await ctx.getCredentials("printIpp");
	const { host, port, username } = credentials as {
		host: string;
		port: number;
		username: string;
	};
	const printerName = ctx.getCurrentNodeParameter("printerName", {
		extractValue: true,
	}) as string;

	let items = defaults;
	if (printerName) {
		const attrs = await fetchPrinterAttributes(
			host,
			port,
			printerName,
			username,
			printerFactory,
		);
		const supported = attrs?.[attrKey] ?? [];
		if (supported.length > 0) {
			items = supported.map((v) => ({ name: labeler(v), value: v }));
		}
	}

	const results = filter
		? items.filter((item) =>
				item.name.toLowerCase().includes(filter.toLowerCase()),
			)
		: items;

	return { results };
}

const nodeDescription: INodeTypeDescription = {
	displayName: "PrintIPP @a24k",
	name: "printIpp",
	icon: "file:printipp.svg",
	group: ["output"],
	version: 1,
	subtitle: "Print Job",
	description:
		"Send print jobs to IPP-capable printers (CUPS or direct IPP) without system-level lp/lpr dependencies",
	defaults: {
		name: "PrintIPP",
	},
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	usableAsTool: true,
	credentials: [
		{
			name: "printIpp",
			required: true,
			testedBy: "printIppCredentialTest",
		},
	],
	properties: [
		{
			displayName: "Printer Name",
			name: "printerName",
			type: "resourceLocator",
			required: true,
			default: { mode: "id", value: "" },
			description: "Printer queue name as registered on the CUPS server",
			modes: [
				{
					displayName: "From List",
					name: "list",
					type: "list",
					typeOptions: {
						searchListMethod: "getCupsPrinters",
						searchable: true,
						searchFilterRequired: false,
					},
				},
				{
					displayName: "By Name",
					name: "id",
					type: "string",
					placeholder: "MyPrinter",
					validation: [
						{
							type: "regex",
							properties: {
								regex: "^[\\w./-]+$",
								errorMessage:
									"Printer name may only contain letters, numbers, hyphens, underscores, dots, and slashes",
							},
						},
					],
				},
			],
		},
		{
			displayName: "Binary Property",
			name: "binaryProperty",
			type: "string",
			required: true,
			default: "data",
			description:
				"Name of the n8n binary property containing the document to print",
		},
		{
			displayName: "Copies",
			name: "copies",
			type: "number",
			default: 1,
			typeOptions: { minValue: 1 },
			description: "Number of copies to print",
		},
		{
			displayName: "Sides",
			name: "sides",
			type: "resourceLocator",
			required: false,
			default: {
				mode: "list",
				value: "one-sided",
				cachedResultName: "One-Sided (IPP General)",
			},
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
		{
			displayName: "Media",
			name: "media",
			type: "resourceLocator",
			required: false,
			default: {
				mode: "list",
				value: "iso_a4_210x297mm",
				cachedResultName: "A4 (IPP General)",
			},
			description:
				"IPP media keyword. Select from printer-supported sizes or enter a PWG media keyword manually.",
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
		{
			displayName: "Color Mode",
			name: "colorMode",
			type: "resourceLocator",
			required: false,
			default: {
				mode: "list",
				value: "color",
				cachedResultName: "Color (IPP General)",
			},
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
		{
			displayName: "Advanced Options",
			name: "advancedOptions",
			type: "collection",
			placeholder: "Add Option",
			default: {},
			options: [
				{
					displayName: "Job Name",
					name: "jobName",
					type: "string",
					default: "n8n print job",
					description: "Value sent as job-name in the IPP request",
				},
				{
					displayName: "Document Format",
					name: "documentFormat",
					type: "string",
					default: "application/pdf",
					description: "IPP document-format MIME type",
				},
			],
		},
	],
};

export class PrintIpp implements INodeType {
	description: INodeTypeDescription = nodeDescription;

	// methods and execute are assigned in the constructor so printerFactory is
	// captured via closure (enables DI for tests without changing the n8n API surface).
	methods: INodeType["methods"];
	execute: (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>;

	constructor(printerFactory: IppPrinterFactory = defaultPrinterFactory) {
		this.methods = {
			credentialTest: {
				async printIppCredentialTest(
					this: ICredentialTestFunctions,
					credential: ICredentialsDecrypted,
				): Promise<INodeCredentialTestResult> {
					const { host, port, username, connectionType } = credential.data as {
						host: string;
						port: number;
						username: string;
						connectionType: string;
					};
					if (connectionType === "cups") {
						return testCupsConnection(host, port, username);
					}
					return {
						status: "Error",
						message: `Unsupported connection type: ${connectionType}`,
					};
				},
			},
			listSearch: {
				async getCupsPrinters(
					this: ILoadOptionsFunctions,
					filter?: string,
				): Promise<INodeListSearchResult> {
					const credentials = await this.getCredentials("printIpp");
					const { host, port, username, connectionType } = credentials as {
						host: string;
						port: number;
						username: string;
						connectionType: string;
					};

					if (connectionType !== "cups") {
						return { results: [] };
					}

					const printers = await fetchCupsPrinters(
						host,
						port,
						username,
						printerFactory,
					);
					const results = printers
						.filter(
							(p) =>
								!filter ||
								p.name.toLowerCase().includes(filter.toLowerCase()) ||
								(p.info ?? "").toLowerCase().includes(filter.toLowerCase()),
						)
						.map((p) => ({
							name: p.info ? `${p.name} (${p.info})` : p.name,
							value: p.name,
						}));

					return { results };
				},

				async getSidesOptions(
					this: ILoadOptionsFunctions,
					filter?: string,
				): Promise<INodeListSearchResult> {
					return listPrinterAttribute(
						this,
						"sidesSupported",
						SIDES_DEFAULTS,
						(v) => SIDES_LABELS[v] ?? v,
						filter,
						printerFactory,
					);
				},

				async getMediaOptions(
					this: ILoadOptionsFunctions,
					filter?: string,
				): Promise<INodeListSearchResult> {
					return listPrinterAttribute(
						this,
						"mediaSupported",
						MEDIA_DEFAULTS,
						labelMedia,
						filter,
						printerFactory,
					);
				},

				async getColorModeOptions(
					this: ILoadOptionsFunctions,
					filter?: string,
				): Promise<INodeListSearchResult> {
					return listPrinterAttribute(
						this,
						"colorModesSupported",
						COLOR_MODE_DEFAULTS,
						(v) => COLOR_MODE_LABELS[v] ?? v,
						filter,
						printerFactory,
					);
				},
			},
		};

		const executeIppJob = (
			printerUrl: string,
			message: object,
		): Promise<IppResponse> => {
			const printer = printerFactory(printerUrl);
			return new Promise((resolve, reject) => {
				printer.execute("Print-Job", message, (err, res) => {
					if (err) reject(err);
					else resolve(res);
				});
			});
		};

		this.execute = async function (
			this: IExecuteFunctions,
		): Promise<INodeExecutionData[][]> {
			const items = this.getInputData();
			const returnData: INodeExecutionData[] = [];

			const credentials = await this.getCredentials("printIpp");
			const host = credentials.host as string;
			const port = credentials.port as number;
			const username = credentials.username as string;

			for (let i = 0; i < items.length; i++) {
				try {
					const printerName = this.getNodeParameter(
						"printerName",
						i,
						undefined,
						{ extractValue: true },
					) as string;
					const binaryProperty = this.getNodeParameter(
						"binaryProperty",
						i,
					) as string;
					const copies = this.getNodeParameter("copies", i) as number;
					const sides = this.getNodeParameter("sides", i, undefined, {
						extractValue: true,
					}) as string;
					const media = this.getNodeParameter("media", i, undefined, {
						extractValue: true,
					}) as string;
					const colorMode = this.getNodeParameter("colorMode", i, undefined, {
						extractValue: true,
					}) as string;
					const advancedOptions = this.getNodeParameter(
						"advancedOptions",
						i,
						{},
					) as {
						jobName?: string;
						documentFormat?: string;
					};

					const jobName = advancedOptions.jobName ?? "n8n print job";
					const documentFormat =
						advancedOptions.documentFormat ?? "application/pdf";

					const buffer = await this.helpers.getBinaryDataBuffer(
						i,
						binaryProperty,
					);

					const printerUrl = `http://${host}:${port}/printers/${printerName}`;
					const message = {
						"operation-attributes-tag": {
							"requesting-user-name": username,
							"job-name": jobName,
							"document-format": documentFormat,
						},
						"job-attributes-tag": {
							copies,
							sides,
							media,
							"print-color-mode": colorMode,
							// CUPS EPSON-compatible grayscale: PPD option "Ink" (COLOR/MONO).
							// CUPS ignores unknown PPD options on other printers, so this is safe universally.
							...(colorMode === "color" && { Ink: "COLOR" }),
							...(colorMode === "monochrome" && { Ink: "MONO" }),
						},
						data: buffer,
					};

					const response = await executeIppJob(printerUrl, message);
					const jobAttrs = response["job-attributes-tag"] ?? {};

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
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: i },
						});
						continue;
					}
					throw new NodeOperationError(this.getNode(), error as Error, {
						itemIndex: i,
					});
				}
			}

			return [returnData];
		};
	}
}
