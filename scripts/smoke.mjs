#!/usr/bin/env node
/**
 * Drives the built server over stdio exactly like an MCP client would, so tools
 * can be exercised against a live Premiere without restarting the assistant.
 *
 *   npm run smoke                     # connection + read-only sweep
 *   npm run smoke -- ping             # one tool, no arguments
 *   npm run smoke -- get_clip '{"node_id":"000f4241"}'
 *   npm run smoke -- --list           # show tool names and exit
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "index.js");
const CALL_TIMEOUT_MS = 180_000;

/** Read-only calls that are safe to run against any open project. */
const DEFAULT_SWEEP = [
  ["ping", {}],
  ["get_timeline", {}],
  ["get_stabilizer_status", {}],
  ["list_effects", { kind: "video", filter: "lumetri" }],
  ["list_export_presets", { filter: "Match Source", limit: 5 }],
];

const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

const pending = new Map();
let inbox = "";
child.stdout.on("data", (chunk) => {
  inbox += chunk.toString();
  let newline;
  while ((newline = inbox.indexOf("\n")) >= 0) {
    const line = inbox.slice(0, newline).trim();
    inbox = inbox.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    } catch {
      /* the server only writes framed JSON, so anything else is noise */
    }
  }
});

let nextId = 1;
function request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ error: { message: `no reply within ${timeoutMs}ms` } }),
      timeoutMs,
    );
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function render(reply) {
  if (reply.error) return { failed: true, text: `transport error: ${reply.error.message}` };
  const text = reply.result?.content?.[0]?.text ?? JSON.stringify(reply.result);
  return { failed: Boolean(reply.result?.isError), text: String(text) };
}

async function main() {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const [first, second] = process.argv.slice(2);

  if (first === "--list") {
    const reply = await request("tools/list", {});
    for (const tool of reply.result?.tools ?? []) console.log(tool.name);
    return 0;
  }

  const calls = first ? [[first, second ? JSON.parse(second) : {}]] : DEFAULT_SWEEP;

  let failures = 0;
  for (const [name, args] of calls) {
    const { failed, text } = render(await request("tools/call", { name, arguments: args }));
    if (failed) failures++;
    console.log(`\n${failed ? "FAIL" : "ok  "}  ${name}`);
    console.log(text.length > 1500 ? `${text.slice(0, 1500)}\n  ...truncated` : text);
  }

  console.log(`\n${calls.length - failures}/${calls.length} passed`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    child.kill();
    process.exit(code);
  })
  .catch((error) => {
    console.error(error);
    child.kill();
    process.exit(1);
  });
