// Ready for Development: checks, the handoff note, and the design marked ready.
//
//   projects/<id>/handoff.md     the note for the engineer: what changed, why, where, open questions
//   projects/<id>/handoff.html   the same, online, with the final version's screens and the change
//   project.json                 status "ready", ready { version, at }
//
// From then on the design stops taking the app's updates; the engineer takes it from here
// (bin/take.mjs), and Liveframe archives it when their pull request is merged.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { DESIGN_REPO, APP_REPO } from "./config.mjs";
import { git, inOrder, commitPaths, pushNow } from "./git.mjs";
import { profile } from "./profile.mjs";
import { checkId, metaOf, writeMeta, save, summary, patchOf, folderOf, appHead } from "./designs.mjs";
import { writeSite, sitePage, esc } from "./site.mjs";
import { markdown } from "./md.mjs";
import { HttpError } from "./http.mjs";
import { notify } from "./events.mjs";

/** Files a patch touches: [{ file, added: [lines] }]. */
function filesIn(patch) {
  const files = [];
  let cur = null;
  for (const line of patch.split("\n")) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      cur = { file: m[2], added: [] };
      files.push(cur);
    } else if (cur && line.startsWith("+") && !line.startsWith("+++")) cur.added.push(line.slice(1));
  }
  return files;
}

const under = (file, paths) => paths.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p || file.startsWith(p + "/")));

/** Does the change still apply to the app as it is now? (In a scratch index; nothing on disk changes.) */
async function appliesTo(sha, patch) {
  const index = path.join(os.tmpdir(), `liveframe-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  const run = (args, input) =>
    new Promise((resolve) => {
      const child = execFile("git", args, { cwd: APP_REPO, env: { ...process.env, ...env }, maxBuffer: 64 << 20 }, (err) => resolve(!err));
      if (input != null) child.stdin.end(input);
    });
  try {
    if (!(await run(["read-tree", sha]))) return false;
    return await run(["apply", "--cached", "--check", "--binary", "-"], patch);
  } finally {
    fs.rmSync(index, { force: true });
  }
}

/** The checks: [{ label, status: pass | note | fail, detail, items? }] and whether it can go. */
export async function readyCheck(id) {
  checkId(id);
  const meta = metaOf(id);
  if (meta.status === "archived") throw new HttpError(409, "archived", "This design is archived.");
  if (meta.status === "ready") throw new HttpError(409, "already_ready", "This design is already with engineering.");
  await save(id);
  const s = await summary(id);
  const p = profile();
  const patch = patchOf(id);
  const files = filesIn(patch);
  const results = [];

  // 1. Something to hand over, published as it is now.
  if (!s.changed) results.push({ label: "Changes", status: "fail", detail: "Nothing in the app has changed yet." });
  else if (!s.latestVersion) results.push({ label: "Published", status: "fail", detail: "Publish it first, so the engineer sees the final version." });
  else if (s.unpublished) results.push({ label: "Published", status: "fail", detail: `Something changed since v${s.latestVersion.n}. Publish again, so the engineer sees the final version.` });
  else results.push({ label: "Published", status: "pass", detail: `v${s.latestVersion.n} · ${s.latestVersion.name} is the latest.` });

  // 1b. One idea left: no ideas file, nothing switching on an idea, no helper.
  const leftovers = [];
  for (const f of files) {
    if (/(^|\/)liveframe\.ideas?\.[a-z]+$|(^|\/)liveframe\.idea\.[a-z]+$/.test(f.file)) leftovers.push(f.file);
    else if (f.added.some((l) => /data-idea|liveframe:idea|__liveframeIdea|liveframe\.idea/.test(l))) leftovers.push(f.file);
  }
  if (leftovers.length) results.push({ label: "One idea left", status: "fail", detail: "The design still has ideas. Tell Claude which one wins: it keeps that one and takes the others and the switcher out.", items: [...new Set(leftovers)] });
  else results.push({ label: "One idea left", status: "pass", detail: "No ideas left to choose between." });

  // 2. Up to date with the app.
  const head = await appHead();
  if (!meta.base || meta.base === head) results.push({ label: "Up to date with the app", status: "pass", detail: `Made on ${p.name}'s latest.` });
  else if (await appliesTo(head, patch)) results.push({ label: "Up to date with the app", status: "pass", detail: `${p.name} changed since, but not in the same places: it still fits.` });
  else results.push({ label: "Up to date with the app", status: "fail", detail: `${p.name} changed in the same places since. Open the design: Liveframe brings it up to date, and Claude sorts out the clash.` });

  // 3. Only the frontend.
  const backend = files.filter((f) => under(f.file, p.backend)).map((f) => f.file);
  const packages = files.filter((f) => /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(f.file)).map((f) => f.file);
  if (backend.length) results.push({ label: "Only the frontend", status: "fail", detail: "These are the app's backend. Ask Claude to take them out and note what's needed in the journal.", items: backend });
  else if (packages.length) results.push({ label: "Only the frontend", status: "note", detail: "The design adds or changes packages. The engineer will check them.", items: packages });
  else results.push({ label: "Only the frontend", status: "pass", detail: `${files.length} file${files.length === 1 ? "" : "s"} changed, all in the frontend.` });

  // 4. Design system: raw values outside the token files, new tokens. Informs, doesn't block.
  const tokenFiles = p.designSystem.tokens;
  const raw = [];
  const newTokens = [];
  for (const f of files) {
    const isTokens = tokenFiles.includes(f.file);
    for (const line of f.added) {
      if (isTokens) {
        const t = /^\s*(--[\w-]+)\s*:/.exec(line);
        if (t) newTokens.push(t[1]);
        continue;
      }
      if (!/\.(css|scss|tsx|jsx|ts|js|vue|svelte)$/.test(f.file)) continue;
      const hit = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\b\d+(\.\d+)?px\b/g);
      if (hit && !/var\(--/.test(line.split(hit[0])[0].slice(-12))) raw.push(`${f.file}: ${hit.slice(0, 3).join(", ")}`);
    }
  }
  if (!raw.length && !newTokens.length) results.push({ label: "Design system", status: "pass", detail: "Uses the app's tokens and components." });
  if (newTokens.length) results.push({ label: "New tokens", status: "note", detail: "The design adds or changes tokens. The design system's owner will check them.", items: [...new Set(newTokens)] });
  if (raw.length) results.push({ label: "Raw values", status: "note", detail: "Values that aren't tokens. Fine if they're one-offs; the engineer will check.", items: raw.slice(0, 12) });

  return { version: s.latestVersion, results, canSend: !results.some((r) => r.status === "fail") };
}

/** The handoff note: Claude writes it from the journal and the change; the journal itself if Claude can't. */
async function writeHandoff(id, meta, v) {
  const dir = folderOf(id);
  const target = path.join(dir, ".liveframe", "handoff.md");
  fs.rmSync(target, { force: true });
  const prompt = `Write the handoff note for the engineer who will build the design "${meta.title}" into the app, to .liveframe/handoff.md, and nothing else.
Read .liveframe/journal.md and the change itself (git diff ${meta.base} HEAD). The note is for an engineer: plain, short, specific.
Sections: "# ${meta.title}", one paragraph on what changed and why (from the designer's point of view), "## What changed" (by page and by component, with the files), "## Design system" (new or changed tokens and components, raw values worth a look; "None" if none), "## For the engineer" (data the design needs, backend work, anything the journal leaves open; "Nothing open" if none), "## Published" (v${v.n} · ${v.name}).
Don't change any other file.`;
  const why = await new Promise((resolve) => {
    execFile("claude", ["-p", prompt, "--allowedTools", "Read,Write,Bash(git diff:*),Bash(git log:*)"], { cwd: dir, timeout: 4 * 60_000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve(err ? (String(stdout || stderr || err.message).trim().split("\n").at(-1) || "it stopped") : null));
  });
  if (!why && fs.existsSync(target) && fs.statSync(target).size > 80) return { note: fs.readFileSync(target, "utf8"), by: "claude" };
  console.error(`[handoff ${id}] Claude didn't write the note: ${why ?? "no note"}`);
  // Without Claude: the brief, the files the change touches, and the journal.
  const files = filesIn(patchOf(id)).map((f) => `- \`${f.file}\``);
  const journal = fs.existsSync(path.join(DESIGN_REPO, "projects", id, "journal.md")) ? fs.readFileSync(path.join(DESIGN_REPO, "projects", id, "journal.md"), "utf8") : "";
  const note = `# ${meta.title}\n\n${meta.brief || ""}\n\n## What changed\n\n${files.join("\n")}\n\n## Published\n\nv${v.n} · ${v.name}\n\n## The design's journal\n\n${journal.replace(/^# .*\n+/, "").replace(/^## /gm, "### ")}`;
  return { note, by: "journal", why: why ?? "Claude didn't write a note" };
}

function handoffPage(id, meta, v, note, repoUrl) {
  const here = `projects/${id}/handoff.html`;
  const body = `<h1>${esc(meta.title)} <span class="chip chip--ready">Ready for Development</span></h1>
<p class="lead">v${v.n} · ${esc(v.name)}. <a href="v${v.n}/index.html">See the screens</a> · <a href="changes.patch">The change (a patch from ${esc(String(meta.base).slice(0, 8))})</a></p>
<p class="lead">To take it: in the app's repo, run <code>/liveframe:take ${esc(id)} ${esc(repoUrl || "<design repo>")}</code> in Claude Code. It makes the branch <code>design/${esc(id)}</code> with the change and this note, and opens the pull request.</p>
<article class="handoff">${markdown(note)}</article>`;
  return sitePage(here, { title: `${meta.title} · handoff`, crumbs: [[`projects/${id}/index.html`, meta.title], [null, "Handoff"]], body });
}

let sending = new Set();

/** Ready for Development: after the checks pass, write the handoff note and mark the design ready. */
export async function markReady(id) {
  if (sending.has(id)) throw new HttpError(409, "busy", "Already sending this design.");
  sending.add(id);
  try {
    const check = await readyCheck(id);
    if (!check.canSend) throw new HttpError(409, "checks_failed", "Fix what the checks found first.");
    const meta = metaOf(id);
    const v = check.version;
    notify({ type: "handoff", project: id, step: "writing" });
    const { note, by, why } = await writeHandoff(id, meta, v);
    const dir = path.join(DESIGN_REPO, "projects", id);
    fs.writeFileSync(path.join(dir, "handoff.md"), note);
    const repoUrl = (await git(["remote", "get-url", "origin"])).stdout.trim().replace(/\.git$/, "");
    fs.writeFileSync(path.join(dir, "handoff.html"), handoffPage(id, meta, v, note, repoUrl));
    meta.status = "ready";
    meta.ready = { version: v.n, at: new Date().toISOString() };
    writeMeta(id, meta);
    await inOrder(async () => {
      await writeSite();
      await commitPaths([`projects/${id}`, "index.html", "liveframe"], `Ready for Development: ${meta.title} v${v.n}`);
    });
    const push = await pushNow();
    notify({ type: "changed", project: id });
    return { version: v, note: { by, why: why ?? null }, pushed: !!push.ok, pushError: push.ok ? null : push.error };
  } finally {
    sending.delete(id);
  }
}
