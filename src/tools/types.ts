import type { z } from "zod";

export interface ToolDefinition<Args = any> {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Args) => Promise<unknown>;
}

export const defineTools = (tools: ToolDefinition[]): ToolDefinition[] => tools;
