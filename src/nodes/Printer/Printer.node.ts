import { Printer as IppPrinter, operations as ippOperations } from "ipp";

// CUPS-Get-Printers (0x4002) is a CUPS extension not included in the ipp package's
// standard operations table. Add it so the serializer writes the correct op code.
ippOperations["CUPS-Get-Printers"] = 0x4002;

import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
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
	"printer-attributes-tag"?: Array<Record<string, unknown>>;
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

export async function testIppConnection(
	host: string,
	port: number,
	username: string,
	printerFactory: IppPrinterFactory = defaultPrinterFactory,
): Promise<INodeCredentialTestResult> {
	try {
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
		const statusCode = response.statusCode ?? "unknown";
		const attrType = Array.isArray(printerAttrs)
			? "array"
			: typeof printerAttrs;
		const count = Array.isArray(printerAttrs)
			? printerAttrs.length
			: printerAttrs != null
				? 1
				: 0;
		if (count === 0) {
			return {
				status: "Error",
				message: `Connection failed: no printers found (status=${statusCode}, tag=${attrType})`,
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

const nodeDescription: INodeTypeDescription = {
	displayName: "Printer (IPP) @a24k",
	name: "printer",
	icon: "file:printer.svg",
	group: ["output"],
	version: 1,
	subtitle: "Print Job",
	description:
		"Send print jobs to IPP-capable printers (CUPS or direct IPP) without system-level lp/lpr dependencies",
	defaults: {
		name: "Printer",
	},
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	usableAsTool: true,
	credentials: [
		{
			name: "printIpp",
			required: true,
			testedBy: "ippCredentialTest",
		},
	],
	properties: [
		{
			displayName: "Printer Name",
			name: "printerName",
			type: "string",
			required: true,
			default: "",
			placeholder: "PX-M6010F",
			description: "Printer queue name as registered in CUPS (e.g. PX-M6010F)",
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

export class Printer implements INodeType {
	description: INodeTypeDescription = nodeDescription;

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

	// Assigned in the constructor so printerFactory is captured via closure,
	// while `this` inside is the IExecuteFunctions context provided by n8n.
	execute: (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>;

	constructor(printerFactory: IppPrinterFactory = defaultPrinterFactory) {
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
					const printerName = this.getNodeParameter("printerName", i) as string;
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
