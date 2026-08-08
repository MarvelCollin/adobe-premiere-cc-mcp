import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError, HostError } from "./errors.js";
import { wrapScript } from "./script.js";

export const BRIDGE_DIR = join(tmpdir(), "premiere-mcp-bridge");

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const CLAIM_TIMEOUT_MS = 5_000;

export interface ScriptEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface BridgeOptions {
  timeoutMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function ensureBridgeDir(): void {
  if (!existsSync(BRIDGE_DIR)) mkdirSync(BRIDGE_DIR, { recursive: true });
}

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8") : null;
  } catch {
    return null;
  }
}

function modifiedAt(path: string): number | null {
  try {
    return existsSync(path) ? statSync(path).mtimeMs : null;
  } catch {
    return null;
  }
}

function remove(...paths: string[]): void {
  for (const path of paths) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      continue;
    }
  }
}

export async function sendScript<T = unknown>(
  script: string,
  options: BridgeOptions = {},
): Promise<ScriptEnvelope<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  ensureBridgeDir();

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const commandPath = join(BRIDGE_DIR, `cmd_${id}.jsx`);
  const responsePath = join(BRIDGE_DIR, `res_${id}.json`);
  const busyPath = join(BRIDGE_DIR, `busy_${id}.json`);

  writeFileSync(commandPath, script, "utf-8");

  const startedAt = Date.now();
  try {
    for (;;) {
      const raw = readIfPresent(responsePath);
      if (raw) {
        try {
          return JSON.parse(raw) as ScriptEnvelope<T>;
        } catch {
          throw new BridgeError(`Panel returned unparseable JSON: ${raw.slice(0, 200)}`);
        }
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed > timeoutMs) {
        const stalled = modifiedAt(busyPath) !== null;
        throw new BridgeError(
          `Script timed out after ${timeoutMs}ms. ` +
            (stalled
              ? "Premiere is still working on it, so either raise timeout_ms or check for a modal dialog waiting for input."
              : "Raise timeout_ms for long operations such as exports, and check Premiere for a modal dialog, which blocks the bridge until dismissed."),
        );
      }

      const unclaimed = existsSync(commandPath);
      const heartbeat = modifiedAt(busyPath);
      if (unclaimed && heartbeat === null && elapsed > CLAIM_TIMEOUT_MS) {
        throw new BridgeError(
          "No response from the MCP Bridge panel. Make sure Premiere Pro is running with a project open; " +
            "if it is, open Window > Extensions > MCP Bridge.",
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    remove(commandPath, responsePath, busyPath);
  }
}

export async function evaluate<T = unknown>(body: string, options: BridgeOptions = {}): Promise<T> {
  const envelope = await sendScript<T>(wrapScript(body), options);
  if (!envelope.ok) throw new HostError(envelope.error ?? "Unknown ExtendScript failure");
  return envelope.data as T;
}
