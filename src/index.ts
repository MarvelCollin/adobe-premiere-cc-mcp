#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BRIDGE_DIR } from "./bridge/client.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} ready (bridge: ${BRIDGE_DIR})\n`);
  await createServer().connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
