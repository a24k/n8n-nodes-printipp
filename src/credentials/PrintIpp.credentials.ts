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
	];
}
