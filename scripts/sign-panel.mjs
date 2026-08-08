#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SIGNER = join(ROOT, "tools", "ZXPSignCmd.exe");
const CERT = join(ROOT, "tools", "panel-cert.p12");
const PANEL = join(ROOT, "panel");
const OUT_DIR = join(ROOT, "artifacts");
const OUT = join(OUT_DIR, "PremiereMcpLink.zxp");

const PASSWORD = process.env.PANEL_CERT_PASSWORD ?? "mcplink2026";

function run(args) {
  return execFileSync(SIGNER, args, { encoding: "utf-8" }).trim();
}

if (!existsSync(SIGNER)) {
  console.error(`ZXPSignCmd is missing at ${SIGNER}.`);
  console.error("Download it from https://github.com/Adobe-CEP/CEP-Resources (ZXPSignCMD/4.1.103/win64).");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync(CERT)) {
  console.log("No certificate yet, generating a self-signed one.");
  run(["-selfSignedCert", "ID", "Jakarta", "MarvelCollin", "Premiere MCP Link", PASSWORD, CERT]);
}

console.log(run(["-sign", PANEL, OUT, CERT, PASSWORD]));
console.log(run(["-verify", OUT]));
console.log(`Signed package: ${OUT}`);
console.log("Install it with: npm run install-panel");
