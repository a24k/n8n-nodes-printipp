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
			type: "options",
			default: "one-sided",
			options: [
				{ name: "One-Sided", value: "one-sided" },
				{
					name: "Two-Sided (Long Edge / Portrait)",
					value: "two-sided-long-edge",
				},
				{
					name: "Two-Sided (Short Edge / Landscape)",
					value: "two-sided-short-edge",
				},
			],
			description: "Duplex printing setting",
		},
		{
			displayName: "Media",
			name: "media",
			type: "string",
			default: "iso_a4_210x297mm",
			placeholder: "iso_a4_210x297mm",
			description:
				"IPP media keyword. Common values: iso_a4_210x297mm, na_letter_8.5x11in, iso_a3_297x420mm",
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
							items = attrs.colorModesSupported.map((v) => ({
								name: v,
								value: v,
							}));
						}
					}

					const results = filter
						? items.filter((item) =>
								item.name.toLowerCase().includes(filter.toLowerCase()),
							)
						: items;

					return { results };
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
					const sides = this.getNodeParameter("sides", i) as string;
					const media = this.getNodeParameter("media", i) as string;
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
