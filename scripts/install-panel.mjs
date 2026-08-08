#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "panel");
const SIGNED = join(HERE, "..", "artifacts", "PremiereMcpLink.zxp");
const FOLDER_NAME = "PremiereMcpLink";

function extensionsDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Adobe", "CEP", "extensions");
  }
  return join(homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
}

function enableUnsignedExtensions() {
  if (platform() !== "win32") {
    console.log("Set PlayerDebugMode manually on macOS:");
    console.log("  defaults write com.adobe.CSXS.12 PlayerDebugMode 1");
    return;
  }
  const versions = [9, 10, 11, 12, 13, 14];
  for (const version of versions) {
    try {
      execFileSync(
        "reg",
        [
          "add",
          `HKCU\\SOFTWARE\\Adobe\\CSXS.${version}`,
          "/v",
          "PlayerDebugMode",
          "/t",
          "REG_SZ",
          "/d",
          "1",
          "/f",
        ],
        { stdio: "ignore" },
      );
    } catch {
      console.warn(`Could not set PlayerDebugMode for CSXS.${version}`);
    }
  }
  console.log("PlayerDebugMode set to 1 (REG_SZ) for CSXS 9 to 14.");
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Panel source missing at ${SOURCE}`);
    process.exit(1);
  }

  const root = extensionsDir();
  const target = join(root, FOLDER_NAME);

  mkdirSync(root, { recursive: true });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });

  if (existsSync(SIGNED)) {
    const staging = join(root, "PremiereMcpLink.zip");
    copyFileSync(SIGNED, staging);
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${staging}' -DestinationPath '${target}' -Force`],
      { stdio: "ignore" },
    );
    rmSync(staging, { force: true });
    console.log(`Installed the signed package to ${target}`);
  } else {
    cpSync(SOURCE, target, { recursive: true });
    console.log(`Installed the unsigned panel to ${target}`);
    console.log("Premiere may refuse it. Run npm run sign-panel first for a signed build.");
  }
  enableUnsignedExtensions();
  console.log("");
  console.log("Next:");
  console.log("  1. Quit Premiere Pro completely, then start it again.");
  console.log("  2. Open Window > Extensions > Premiere MCP Link.");
  console.log("  3. Run: npm run smoke -- ping");
  console.log("");
  console.log("If the panel does not appear, Premiere refused an unsigned extension.");
  console.log("Check %LOCALAPPDATA%\\Temp\\CEP12-PPRO.log for a signature error.");
}

main();
