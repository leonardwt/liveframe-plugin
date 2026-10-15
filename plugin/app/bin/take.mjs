#!/usr/bin/env node
// The engineer takes a design into the app. Run it in the app's repo:
//
//   node take.mjs <design> --design <design repo: a copy on this Mac, or its GitHub address>
//                 [--no-push] [--no-pr]
//
// It brings the design's change onto a new branch design/<design>, cut from the commit the design
// started from and moved onto the app's latest, with the handoff note as its message; then pushes
// it and opens a pull request into the app's main line. Liveframe archives the design once that
// pull request is merged. (The /liveframe:take skill runs this, then helps with what's left:
// connecting real data, the open questions in the note.)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { design: { type: "string" }, "no-push": { type: "boolean" }, "no-pr": { type: "boolean" } } });
const id = positionals[0];
if (!id || !values.design) {
  console.error("Usage: node take.mjs <design> --design <design repo copy or GitHub address> [--no-push] [--no-pr]");
  process.exit(2);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
const git = (...args) => run("git", args);
const tryGit = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message) };
  }
};
const step = (t) => console.log(`· ${t}`);

// The design repo: a copy on this Mac, or a fresh shallow one from GitHub.
let designRepo = values.design;
if (!fs.existsSync(designRepo)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liveframe-take-"));
  run("git", ["clone", "-q", "--depth", "1", values.design, tmp]);
  designRepo = tmp;
} else {
  tryGit("-C", designRepo, "pull", "-q", "--ff-only");
}
const dir = path.join(designRepo, "projects", id);
if (!fs.existsSync(path.join(dir, "project.json"))) throw new Error(`There's no design "${id}" in ${values.design}.`);
const meta = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
const app = JSON.parse(fs.readFileSync(path.join(designRepo, "liveframe", "app.json"), "utf8"));
if (meta.status !== "ready") throw new Error(`"${meta.title}" isn't Ready for Development yet.`);
const patch = fs.readFileSync(path.join(dir, "changes.patch"), "utf8");
const note = fs.existsSync(path.join(dir, "handoff.md")) ? fs.readFileSync(path.join(dir, "handoff.md"), "utf8") : `# ${meta.title}\n`;
step(`${meta.title}: v${meta.ready.version}, from ${app.name} ${meta.base.slice(0, 8)}`);

// Here: the app's repo, clean.
if (tryGit("rev-parse", "--git-dir").ok === false) throw new Error("Run this in the app's repo.");
if (git("status", "--porcelain")) throw new Error("This repo has changes that aren't committed. Commit or stash them first.");
const branch = `design/${id}`;
const main = app.branch ?? "main";
git("fetch", "-q", "origin");
if (tryGit("rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok) throw new Error(`There's already a branch ${branch} here.`);
if (!tryGit("cat-file", "-e", `${meta.base}^{commit}`).ok) throw new Error(`This repo doesn't have ${meta.base.slice(0, 8)}, the commit the design started from.`);

// The design's change, on the commit it started from…
git("switch", "-q", "-c", branch, meta.base);
const applied = (() => {
  try {
    run("git", ["apply", "--binary", "--index", "--whitespace=nowarn", "-"], { input: patch });
    return true;
  } catch (e) {
    return String(e.stderr || e.message);
  }
})();
if (applied !== true) throw new Error(`The design's change didn't apply: ${applied}`);
const title = `Design: ${meta.title}`;
const msgFile = path.join(os.tmpdir(), `liveframe-take-${id}.md`);
fs.writeFileSync(msgFile, `${title}\n\n${note.replace(/^# .*\n+/, "")}\n\nDesigned with Liveframe (design repo: ${values.design}, projects/${id}).\n`);
git("commit", "-q", "-F", msgFile);
step(`The design's change on ${branch}`);

// …then onto the app's latest.
if (git("rev-parse", `origin/${main}`) !== meta.base) {
  const r = tryGit("rebase", "-q", `origin/${main}`);
  if (!r.ok) {
    console.log(`\nThe app changed in the same places since the design was made. Sort out the clash (git status shows where), then:\n  git rebase --continue && git push -u origin ${branch}\n`);
    process.exit(1);
  }
  step(`Moved onto ${app.name}'s latest (${main})`);
}

if (values["no-push"]) {
  step(`Not pushed (--no-push). The branch is ${branch}.`);
  process.exit(0);
}
git("push", "-q", "-u", "origin", branch);
step("Pushed");
if (values["no-pr"]) process.exit(0);
const body = `${note}\n\n---\nDesigned with Liveframe. Published version: v${meta.ready.version}. Merge this and Liveframe archives the design.\n`;
const url = run("gh", ["pr", "create", "--base", main, "--head", branch, "--title", title, "--body-file", "-"], { input: body });
step(`Pull request: ${url}`);
