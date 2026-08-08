import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allTools, type ToolDefinition } from "./tools/index.js";

export const SERVER_NAME = "adobe-premiere-cc-mcp";
export const SERVER_VERSION = "0.1.0";

async function runTool(tool: ToolDefinition, args: unknown) {
  try {
    const data = await tool.handler(args ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text" as const, text: message }] };
  }
}

export function createServer(tools: ToolDefinition[] = allTools): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      (args: unknown) => runTool(tool, args),
    );
  }

  return server;
}
