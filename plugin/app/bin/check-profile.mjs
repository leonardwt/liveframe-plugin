#!/usr/bin/env node
// Try an app profile before setup writes it (part of /liveframe:setup): runs the app the way the
// profile says, from a scratch copy of the app's main line, and opens every page it lists, signed in.
// Reads the token files and component folders too. Prints a report and exits 1 if the app didn't run.
//
//   node check-profile.mjs --app <app copy> --profile <app.json> [--port 3990] [--keep]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync, spawn } from "node:child_process";

const { values } = parseArgs({ options: { app: { type: "string" }, profile: { type: "string" }, port: { type: "string" }, keep: { type: "boolean" } } });
if (!values.app || !values.profile) {
  console.error("Usage: node check-profile.mjs --app <app copy> --profile <app.json>");
  process.exit(2);
}
const app = path.resolve(values.app);
const p = JSON.parse(fs.readFileSync(values.profile, "utf8"));
const port = Number(values.port ?? 3990);
const fill = (s) => String(s).replace(/\{port\}/g, String(port));
const git = (...args) => execFileSync("git", args, { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = [];
const out = (ok, label, detail) => lines.push(`${ok === true ? "✓" : ok === false ? "✗" : "·"} ${label}${detail ? `: ${detail}` : ""}`);
let bad = false;

// The profile itself.
for (const key of ["name", "repo", "branch", "run", "pages", "designSystem"]) if (!p[key]) out(false, `profile: "${key}" is missing`), (bad = true);
const ref = `origin/${p.branch}`;
try {
  git("fetch", "-q", "origin");
  out(true, "app copy", `${p.branch} at ${git("rev-parse", "--short", ref)}`);
} catch (e) {
  out(false, "app copy", `can't read ${ref}: ${String(e.stderr || e.message).trim()}`);
  console.log(lines.join("\n"));
  process.exit(1);
}

// Tokens and components, read the way the design system reads them.
for (const f of p.designSystem?.tokens ?? []) {
  try {
    const css = git("show", `${ref}:${f}`);
    const n = (css.match(/--[A-Za-z0-9_-]+\s*:/g) ?? []).length;
    out(n > 0, `tokens ${f}`, `${n} custom properties`);
  } catch {
    out(false, `tokens ${f}`, "not in the app");
  }
}
if (!(p.designSystem?.tokens ?? []).length) out(null, "tokens", "none named: the design system's token pages will be empty");
for (const d of p.designSystem?.components ?? []) {
  try {
    const n = git("ls-tree", "--name-only", `${ref}:${d}`).split("\n").filter((x) => /^[A-Za-z]/.test(x) && !/\.(test|spec|stories)\./.test(x) && (/\.(tsx|jsx|vue|svelte)$/.test(x) || !x.includes("."))).length;
    out(n > 0, `components ${d}`, `${n} found`);
  } catch {
    out(false, `components ${d}`, "not in the app");
  }
}
for (const f of [...(p.frontend ?? []), ...(p.backend ?? [])]) {
  try {
    git("cat-file", "-e", `${ref}:${f.replace(/\/$/, "")}`);
  } catch {
    out(null, `path ${f}`, "not in the app (check the frontend/backend lists)");
  }
}

// Run it: a scratch worktree, the profile's install and run, every page signed in.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liveframe-check-"));
let proc = null;
const cleanup = () => {
  if (proc) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {}
  }
  if (!values.keep) {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
process.on("SIGINT", () => (cleanup(), process.exit(130)));
try {
  git("worktree", "add", "-q", "--detach", dir, ref);
  if (p.install?.length) {
    const t = Date.now();
    try {
      execFileSync(p.install[0], p.install.slice(1), { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", HUSKY: "0" } });
      out(true, "install", `${Math.round((Date.now() - t) / 1000)} s`);
    } catch (e) {
      out(false, "install", String(e.stderr || e.message).trim().split("\n").slice(-3).join(" "));
      throw new Error("stop");
    }
  }
  const env = { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", ...Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, fill(v)])) };
  const [cmd, ...args] = p.run.map(fill);
  const logFile = path.join(dir, ".liveframe-check.log");
  const log = fs.openSync(logFile, "w");
  proc = spawn(cmd.startsWith(".") || cmd.includes("/") ? path.resolve(dir, cmd) : cmd, args, { cwd: dir, env, stdio: ["ignore", log, log], detached: true });
  const headers = p.signIn?.cookie ? { cookie: p.signIn.cookie } : {};
  const t = Date.now();
  let up = false;
  while (Date.now() - t < 240_000 && !up && proc.exitCode == null) {
    try {
      await fetch(`http://127.0.0.1:${port}${p.ready ?? "/"}`, { headers, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!up) {
    out(false, "run", `the app didn't answer on ${port}. Its last lines: ${fs.readFileSync(logFile, "utf8").trim().split("\n").slice(-4).join(" | ")}`);
    throw new Error("stop");
  }
  out(true, "run", `answering after ${Math.round((Date.now() - t) / 1000)} s`);
  for (const pg of p.pages ?? []) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${pg.route}`, { headers, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      const html = r.status === 200 ? await r.text() : "";
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      const where = r.headers.get("location");
      if (r.status === 200) out(true, `page ${pg.name} (${pg.route})`, title ? `"${title}"` : "200");
      else if (r.status >= 300 && r.status < 400) out(false, `page ${pg.name} (${pg.route})`, `sends to ${where}: not signed in? (check "signIn")`);
      else out(false, `page ${pg.name} (${pg.route})`, `status ${r.status}`);
    } catch (e) {
      out(false, `page ${pg.name} (${pg.route})`, e.message);
    }
  }
} catch (e) {
  if (e.message !== "stop") out(false, "check", e.message);
  bad = true;
} finally {
  cleanup();
}
if (lines.some((l) => l.startsWith("✗"))) bad = true;
console.log(lines.join("\n"));
console.log(bad ? "\nThe profile needs work before setup." : "\nThe profile works.");
process.exit(bad ? 1 : 0);
