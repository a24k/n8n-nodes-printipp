declare module "ipp" {
	interface PrinterOptions {
		charset?: string;
		language?: string;
		uri?: string;
		version?: string;
	}

	type IppCallback = (err: Error | null, res: IppResponse) => void;

	interface IppResponse {
		version?: string;
		statusCode?: string;
		id?: number;
		"operation-attributes-tag"?: Record<string, unknown>;
		"job-attributes-tag"?: Record<string, unknown>;
		"unsupported-attributes"?: unknown;
	}

	interface PrinterInstance {
		execute(operation: string, message: object, callback: IppCallback): void;
	}

	function Printer(url: string, options?: PrinterOptions): PrinterInstance;

	export { Printer };
}
