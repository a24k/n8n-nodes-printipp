import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class PrintIpp implements ICredentialType {
	name = "printIpp";
	displayName = "PrintIPP Endpoint";
	documentationUrl = "https://github.com/a24k/n8n-nodes-printipp";
	properties: INodeProperties[] = [
		{
			displayName: "Connection Type",
			name: "connectionType",
			type: "options",
			options: [{ name: "CUPS Server", value: "cups" }],
			default: "cups",
		},
		{
			displayName: "Protocol",
			name: "protocol",
			type: "options",
			options: [
				{ name: "HTTP (IPP)", value: "http" },
				{ name: "HTTPS (IPPS)", value: "https" },
			],
			default: "http",
			description:
				"Transport protocol. Use HTTPS for encrypted connections (IPPS).",
		},
		{
			displayName: "Host",
			name: "host",
			type: "string",
			default: "",
			placeholder: "localhost",
			description: "CUPS/IPP server hostname or IP address",
		},
		{
			displayName: "Port",
			name: "port",
			type: "number",
			default: 631,
			placeholder: "631",
			description: "IPP port (default: 631)",
		},
		{
			displayName: "Username",
			name: "username",
			type: "string",
			default: "n8n",
			placeholder: "n8n",
			description: "Value sent as requesting-user-name in IPP requests",
		},
		{
			displayName: "Password",
			name: "password",
			type: "string",
			default: "",
			typeOptions: { password: true },
			description:
				"HTTP Basic Authentication password. Leave empty to disable Basic Auth.",
		},
		{
			displayName: "Skip Certificate Validation",
			name: "skipCertValidation",
			type: "boolean",
			default: false,
			displayOptions: { show: { protocol: ["https"] } },
			description:
				"Whether to accept self-signed or untrusted TLS certificates. Enable only for trusted private networks.",
		},
	];
}
