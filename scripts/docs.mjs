#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const README = join(HERE, "..", "README.md");
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

const { allTools } = await import(pathToFileURL(join(HERE, "..", "dist", "tools", "index.js")).href);

function firstSentence(text) {
  const match = text.match(/^(.*?[.!?])(\s|$)/s);
  return (match ? match[1] : text).replace(/\s+/g, " ").trim();
}

function signature(tool) {
  const names = Object.keys(tool.schema);
  return names.length === 0 ? "—" : names.map((name) => `\`${name}\``).join(", ");
}

const rows = allTools
  .map((tool) => `| \`${tool.name}\` | ${signature(tool)} | ${firstSentence(tool.description)} |`)
  .join("\n");

const table = [
  `${allTools.length} tools.`,
  "",
  "| Tool | Parameters | What it does |",
  "| --- | --- | --- |",
  rows,
].join("\n");

const readme = readFileSync(README, "utf-8");
const startAt = readme.indexOf(START);
const endAt = readme.indexOf(END);

if (startAt === -1 || endAt === -1) {
  console.error(`README is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const updated = `${readme.slice(0, startAt + START.length)}\n\n${table}\n\n${readme.slice(endAt)}`;

if (updated === readme) {
  console.log("Tool table already up to date.");
} else {
  writeFileSync(README, updated, "utf-8");
  console.log(`Tool table regenerated with ${allTools.length} tools.`);
}
