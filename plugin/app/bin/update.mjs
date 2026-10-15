#!/usr/bin/env node
// /liveframe:update: is there a newer Liveframe, what's new in it, and updating to it.
//
//   node update.mjs            check: this version, the latest on GitHub, and what's new since
//                              (exits 0 up to date, 10 when there's an update)
//   node update.mjs --apply    update the plugin, then restart the Liveframes that were running here
//
// The latest version and what's new come from the plugin's GitHub repo (plugin.json and
// CHANGELOG.md). Updating uses Claude Code's own commands.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const { values } = parseArgs({ options: { apply: { type: "boolean" } } });
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const PLUGIN = path.dirname(ROOT);
const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
const mine = manifest.version;
const slug = /github\.com\/([^/]+\/[^/.]+)/.exec(manifest.repository ?? "")?.[1];
const MARKET = "liveframe";
const ID = `${manifest.name}@${MARKET}`;

const newer = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const raw = async (file) => {
  const r = await fetch(`https://raw.githubusercontent.com/${slug}/main/${file}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`couldn't read ${file} from GitHub (${r.status})`);
  return r.text();
};

/** The changelog's sections newer than `from`, up to and including `to`. */
function whatsNew(changelog, from, to) {
  const parts = changelog.split(/^## /m).slice(1);
  return parts
    .map((p) => ({ v: p.split("\n")[0].trim(), body: p.slice(p.indexOf("\n") + 1).trim() }))
    .filter((p) => newer(p.v, from) && !newer(p.v, to))
    .map((p) => `### ${p.v}\n\n${p.body}`)
    .join("\n\n");
}

if (!slug) {
  console.error("✗ This Liveframe doesn't say where it comes from (no GitHub repository in plugin.json).");
  process.exit(1);
}

// ---------- check ----------

if (!values.apply) {
  let latest, changelog;
  try {
    latest = JSON.parse(await raw("plugin/.claude-plugin/plugin.json")).version;
    changelog = await raw("CHANGELOG.md").catch(() => "");
  } catch (e) {
    console.error(`✗ Couldn't check for updates: ${e.message}. Are you online?`);
    process.exit(1);
  }
  if (!newer(latest, mine)) {
    console.log(`Up to date: Liveframe ${mine} is the latest.`);
    process.exit(0);
  }
  console.log(`Update available: ${mine} → ${latest}\n`);
  console.log(whatsNew(changelog, mine, latest) || "(No notes for this update.)");
  process.exit(10);
}

// ---------- apply ----------

const run = (args) => execFileSync("claude", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  run(["plugin", "marketplace", "update", MARKET]);
  run(["plugin", "update", ID]);
} catch (e) {
  console.error(`✗ The update didn't go through: ${String(e.stderr || e.message).trim().split("\n").slice(-2).join(" ")}`);
  process.exit(1);
}
const installed = JSON.parse(run(["plugin", "list", "--json"])).find((p) => p.id === ID);
if (!installed) {
  console.error(`✗ Updated, but Claude Code doesn't list ${ID} any more.`);
  process.exit(1);
}
console.log(`Updated: Liveframe ${mine} → ${installed.version}.`);

// The Liveframes running on this Mac run the old version until they restart.
const open = path.join(installed.installPath, "app", "bin", "open.mjs");
let config = { repos: {} };
try {
  config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".liveframe", "config.json"), "utf8"));
} catch {}
for (const r of Object.values(config.repos ?? {})) {
  let up = false;
  try {
    up = (await fetch(`http://localhost:${r.port}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {}
  if (!up) continue;
  try {
    execFileSync(process.execPath, [open, "--stop", r.name], { stdio: "ignore" });
    await new Promise((res) => setTimeout(res, 1500));
    execFileSync(process.execPath, [open, r.design, "--no-open"], { stdio: "ignore" });
    console.log(`Restarted Liveframe for ${r.name} on the new version: http://localhost:${r.port}`);
  } catch {
    console.log(`Liveframe for ${r.name} needs a restart: run /liveframe:open stop, then /liveframe:open.`);
  }
}
console.log("Start a new Claude session to use the new version's commands.");
