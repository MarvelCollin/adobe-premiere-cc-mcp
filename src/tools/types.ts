import type { z } from "zod";

/**
 * One MCP tool. Handlers return plain data; the server layer serialises it and
 * turns thrown errors into MCP error results, so handlers never format output.
 */
export interface ToolDefinition<Args = any> {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Args) => Promise<unknown>;
}

/** Convenience for declaring a module's tools with inference intact. */
export const defineTools = (tools: ToolDefinition[]): ToolDefinition[] => tools;
