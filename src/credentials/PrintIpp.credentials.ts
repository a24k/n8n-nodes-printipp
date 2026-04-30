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
      options: [
        { name: "CUPS Server", value: "cups" },
        { name: "Direct IPP Printer", value: "ipp" },
      ],
      default: "cups",
      description:
        "Server type. Use CUPS Server for a CUPS print server, or Direct IPP Printer for a network printer (IPP Everywhere, AirPrint, vendor IPP).",
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
      displayName: "Printer Path",
      name: "printerPath",
      type: "string",
      default: "/ipp/print",
      placeholder: "/ipp/print",
      displayOptions: { show: { connectionType: ["ipp"] } },
      description:
        "Path component of the printer's IPP endpoint URL (e.g. /ipp/print, /ipp/printer, /). The full URL is {protocol}://{host}:{port}{printerPath}.",
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
