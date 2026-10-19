#!/usr/bin/env node
// Refresh spec/discord-openapi.json from the official Discord API spec and print the operation diff.
// Usage: node scripts/update-spec.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_URL = 'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'spec', 'discord-openapi.json');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function operationsOf(spec) {
  const map = new Map();
  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (op?.operationId) map.set(op.operationId, `${method.toUpperCase()} ${route}`);
    }
  }
  return map;
}

function diff(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, sig] of after) {
    if (!before.has(id)) added.push(`${id}  ${sig}`);
    else if (before.get(id) !== sig) changed.push(`${id}  ${before.get(id)} -> ${sig}`);
  }
  for (const [id, sig] of before) if (!after.has(id)) removed.push(`${id}  ${sig}`);
  return { added, removed, changed };
}

function printSection(title, lines) {
  console.log(`\n${title} (${lines.length})`);
  for (const line of lines) console.log(`  ${line}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const text = await res.text();
  const next = JSON.parse(text);
  const current = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) : { paths: {} };
  const before = operationsOf(current);
  const after = operationsOf(next);
  const { added, removed, changed } = diff(before, after);
  console.log(`operations: ${before.size} -> ${after.size}`);
  printSection('added', added);
  printSection('removed', removed);
  printSection('changed (method or path)', changed);
  if (dryRun) {
    console.log('\n--dry-run: snapshot not written');
    return;
  }
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, text);
  console.log(`\nwrote ${path.relative(ROOT, SNAPSHOT)} (${text.length} chars)`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
