import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from "n8n-workflow";

export class IppApi implements ICredentialType {
	name = "ippApi";
	displayName = "IPP API";
	documentationUrl = "https://github.com/a24k/n8n-nodes-printipp";
	test: ICredentialTestRequest = {
		request: {
			baseURL: "=http://{{$credentials.host}}:{{$credentials.port}}",
			url: "/",
		},
	};
	properties: INodeProperties[] = [
		{
			displayName: "Host",
			name: "host",
			type: "string",
			default: "",
			placeholder: "cupsd",
			description: "CUPS/IPP server hostname or IP address",
		},
		{
			displayName: "Port",
			name: "port",
			type: "number",
			default: 631,
			description: "IPP port (default: 631)",
		},
		{
			displayName: "Username",
			name: "username",
			type: "string",
			default: "n8n",
			description: "Value sent as requesting-user-name in IPP requests",
		},
	];
}
