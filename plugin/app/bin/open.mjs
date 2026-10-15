#!/usr/bin/env node
// /liveframe:open: start Liveframe for a design repo on this Mac, in the background, and open it.
// The first time it checks the Mac and gets copies of the design repo and the app; after that it
// remembers them.
//
//   node open.mjs [<design repo: GitHub address or folder>]   start (or say it's running) and open it
//                 [--app <app address or folder>] [--port 4300] [--home ~/Liveframe] [--no-open]
//   node open.mjs --status                                    which Liveframes run here
//   node open.mjs --stop [<name>]                             stop one (or all)
//
// Copies go in <home>/<name> (default ~/Liveframe). What it remembers: ~/.liveframe/config.json.
// Each Liveframe logs to ~/.liveframe/<design repo>/liveframe.log.

import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync, spawn } from "node:child_process";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { design: { type: "string" }, app: { type: "string" }, port: { type: "string" }, home: { type: "string" }, "no-open": { type: "boolean" }, status: { type: "boolean" }, stop: { type: "boolean" } },
});
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const HOME = os.homedir();
const STATE = path.join(HOME, ".liveframe");
const CONFIG = path.join(STATE, "config.json");
const say = (t) => console.log(t);
const fail = (t) => {
  console.error(`✗ ${t}`);
  process.exit(1);
};
const tilde = (p) => p.replace(/^~(?=$|\/)/, HOME);
const short = (p) => p.replace(HOME, "~");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return { repos: {} };
  }
}
function writeConfig(c) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + "\n");
}
const has = (cmd) => {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
async function health(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ---------- --status and --stop ----------

const config = readConfig();
if (values.status || values.stop) {
  const names = values.stop && positionals[0] ? [positionals[0]] : Object.keys(config.repos);
  if (!names.length) say("No Liveframe set up on this Mac yet.");
  for (const name of names) {
    const r = config.repos[name];
    if (!r) fail(`No Liveframe called ${name} here.`);
    const h = await health(r.port);
    if (values.stop) {
      if (r.pid && alive(r.pid)) process.kill(r.pid, "SIGTERM");
      say(h ? `Stopped ${name}.` : `${name} wasn't running.`);
    } else say(`${name}: ${h ? `running at http://localhost:${r.port}` : "not running"} · designs from ${short(r.design)} · app from ${short(r.app)}`);
  }
  process.exit(0);
}

// ---------- which design repo ----------

const where = values.design ?? positionals[0];
const home = path.resolve(tilde(values.home ?? path.join(HOME, "Liveframe")));
let entry = null;
if (where) {
  const name = path.basename(where.replace(/\.git$/, "").replace(/\/+$/, ""));
  entry = config.repos[name] ?? { name };
  entry.source = where;
} else {
  entry = config.repos[config.last];
  if (!entry) fail("Which design repo? Give its GitHub address the first time, e.g. node open.mjs https://github.com/<org>/<design repo>.");
}

// ---------- this Mac ----------

const missing = [];
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) missing.push(`Node 22 or newer (this is ${process.versions.node}): https://nodejs.org`);
if (!has("git")) missing.push("git: run `xcode-select --install`");
if (!fs.existsSync(process.env.LIVEFRAME_CHROME ?? "/Applications/Google Chrome.app")) missing.push("Google Chrome (Liveframe uses it for pictures of screens and for Publish): https://www.google.com/chrome");
if (!has("gh")) missing.push("GitHub's command-line tool, gh (to see pull requests): `brew install gh`, then `gh auth login`");
else {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
  } catch {
    missing.push("Sign in to GitHub: `gh auth login`");
  }
}
if (missing.length) {
  say("This Mac needs a few things first:");
  for (const m of missing) say(`  - ${m}`);
  process.exit(1);
}

// ---------- the copies ----------

/** A folder for `src`: itself if it's a folder, else a copy cloned into <home>/<name>. */
function copyOf(src, branch) {
  if (fs.existsSync(tilde(src))) return path.resolve(tilde(src));
  const name = path.basename(src.replace(/\.git$/, "").replace(/\/+$/, ""));
  const dir = path.join(home, name);
  if (fs.existsSync(path.join(dir, ".git"))) return dir;
  fs.mkdirSync(home, { recursive: true });
  say(`· Getting ${name}…`);
  try {
    execFileSync("git", ["clone", "-q", ...(branch ? ["-b", branch] : []), src, dir], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    fail(`Couldn't get ${src}: ${String(e.stderr || e.message).trim()}\n  Do you have access to it on GitHub?`);
  }
  return dir;
}

if (entry.source) entry.design = copyOf(entry.source);
if (!entry.design || !fs.existsSync(entry.design)) fail(`The design repo isn't at ${entry.design} any more. Run again with its GitHub address.`);
const profileFile = path.join(entry.design, "liveframe", "app.json");
if (!fs.existsSync(profileFile)) fail(`${short(entry.design)} isn't set up for Liveframe yet (no liveframe/app.json). Someone runs /liveframe:setup first.`);
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
if (values.app || !entry.app || !fs.existsSync(entry.app)) entry.app = copyOf(values.app ?? profile.repo, profile.branch);
const tool = profile.install?.[0];
if (tool && !has(tool)) fail(`${profile.name} installs its packages with ${tool}, which this Mac doesn't have. Install it: \`${has("brew") ? `brew install ${tool}` : `npm install -g ${tool}`}\`, then run this again.`);
delete entry.source;

// ---------- running? ----------

const port0 = Number(values.port ?? entry.port ?? 4300);
const running = entry.port && (await health(entry.port));
if (running && path.resolve(running.designRepo) === path.resolve(entry.design)) {
  say(`Liveframe for ${profile.name} is already running: http://localhost:${entry.port}`);
} else {
  // A free port, not one another Liveframe on this Mac uses.
  const taken = new Set(Object.values(config.repos).filter((r) => r.name !== entry.name).map((r) => r.port));
  let port = port0;
  while (taken.has(port) || !(await portFree(port))) port++;
  const state = path.join(STATE, entry.name);
  fs.mkdirSync(state, { recursive: true });
  const log = fs.openSync(path.join(state, "liveframe.log"), "a");
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      LIVEFRAME_PORT: String(port),
      LIVEFRAME_DESIGN_REPO: entry.design,
      LIVEFRAME_APP_REPO: entry.app,
      LIVEFRAME_DESIGNS_DIR: path.join(home, "designs", entry.name),
      LIVEFRAME_STATE_DIR: state,
    },
  });
  child.unref();
  entry.port = port;
  entry.pid = child.pid;
  let ok = null;
  for (let i = 0; i < 40 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 250));
    ok = await health(port);
  }
  if (!ok) fail(`Liveframe didn't start. Its log: ${short(path.join(state, "liveframe.log"))}`);
  say(`Liveframe for ${profile.name} is running: http://localhost:${port}`);
}
say(`  Designs from ${short(entry.design)} · ${profile.name} from ${short(entry.app)}`);
if (profile.site) say(`  Online: ${profile.site}`);

config.repos[entry.name] = entry;
config.last = entry.name;
writeConfig(config);
if (!values["no-open"]) spawn("open", [`http://localhost:${entry.port}`], { stdio: "ignore", detached: true }).unref();
