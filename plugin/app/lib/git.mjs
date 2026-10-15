// git, never through a shell: arguments go straight to git.

import { execFile } from "node:child_process";
import { DESIGN_REPO, NO_PUSH } from "./config.mjs";

/** Runs git (in the design repo unless cwd says otherwise). Resolves { code, stdout, stderr } (stdout a Buffer when raw). */
export function git(args, { raw = false, cwd = DESIGN_REPO, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile("git", args, { cwd, encoding: raw ? "buffer" : "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr: String(stderr ?? "") });
    });
    if (input != null) child.stdin.end(input);
  });
}

/** git, but a failure throws with git's own message. Returns trimmed stdout (a Buffer when raw). */
export async function gitOk(args, opts) {
  const r = await git(args, opts);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim() || String(r.stdout).trim()}`);
  return opts?.raw ? r.stdout : r.stdout.trim();
}

// ---------- the design repo ----------

// One change to the design repo at a time: saves, publishes and design-system updates all commit.
let queue = Promise.resolve();
export function inOrder(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** Commit these paths in the design repo (nothing when they didn't change). True when it committed. */
export async function commitPaths(paths, message) {
  await gitOk(["add", "-A", "--", ...paths]);
  if ((await git(["diff", "--cached", "--quiet", "--", ...paths])).code === 0) return false;
  await gitOk(["commit", "-q", "-m", message, "--", ...paths]);
  return true;
}

export const hasRemote = async () => (await git(["remote"])).stdout.trim().length > 0;

// Pushes: soon after a change, one at a time; a push that fails (offline) is tried again later.
let pushTimer = null;
let pushing = false;
let lastPush = { ok: null, at: null, error: null };
export const pushState = () => lastPush;

/** Push the design repo in a few seconds (saves come in bursts). */
export function pushSoon(ms = 5000) {
  if (NO_PUSH) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, ms);
  pushTimer.unref();
}

/** Push now: brings in what others pushed first (their designs, design-system updates), then sends ours. */
export async function pushNow() {
  if (NO_PUSH || pushing || !(await hasRemote())) return lastPush;
  pushing = true;
  try {
    const branch = (await gitOk(["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
    await inOrder(async () => {
      const pull = await git(["pull", "-q", "--rebase", "--autostash", "origin", branch]);
      // An empty repo on GitHub has no branch yet: the first push makes it.
      if (pull.code !== 0 && !/couldn't find remote ref/i.test(pull.stderr)) throw new Error(pull.stderr.trim());
      await gitOk(["push", "-q", "-u", "origin", branch]);
    });
    lastPush = { ok: true, at: new Date().toISOString(), error: null };
  } catch (e) {
    lastPush = { ok: false, at: new Date().toISOString(), error: e.message };
    console.error(`[push] ${e.message}`);
    pushSoon(60_000);
  } finally {
    pushing = false;
  }
  return lastPush;
}
