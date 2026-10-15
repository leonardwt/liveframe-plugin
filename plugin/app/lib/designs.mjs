// Designs: what's kept in the design repo, and each design's folder and running app on this Mac.
//
// In the design repo (shared through GitHub):
//   projects/<id>/project.json     { title, brief, designer, createdAt, base, screens, status, ready, pr, archivedAt }
//   projects/<id>/changes.patch    the design: its change to the app's code, from `base` (an app commit)
//   projects/<id>/journal.md       the design's journal, kept by Claude
//   projects/<id>/v<n>/            published versions (lib/publish.mjs)
//
// On this Mac only:
//   <DESIGNS_DIR>/<id>/            the design's folder: a git worktree of the app copy, on a local
//                                  branch design/<id> cut from `base`. Claude works here.
//     CLAUDE.local.md              Liveframe's rules for Claude (from kit/, never part of the change)
//     .liveframe/journal.md        the journal while Claude works on it
//   the app running from the folder, behind a proxy that signs in (lib/proxy.mjs)
//
// Saving: when the folder settles after a change, Liveframe commits it on the design's branch,
// writes the whole change since `base` to changes.patch, copies the journal, commits that in the
// design repo and pushes it soon after. On another Mac, opening the design makes its folder from
// `base` and changes.patch.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { DESIGN_REPO, APP_REPO, DESIGNS_DIR, STATE_DIR, APP_PORTS, MAX_RUNNING, IDLE_MS, PORT, ROOT } from "./config.mjs";
import { git, gitOk, inOrder, commitPaths, pushSoon } from "./git.mjs";
import { profile, fill } from "./profile.mjs";
import { startProxy } from "./proxy.mjs";
import { HttpError } from "./http.mjs";
import { notify } from "./events.mjs";
import { readIdeas } from "./ideas.mjs";
import { whoAmI, labelOf, isMine } from "./identity.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const KIT = path.join(ROOT, "kit");
const LOGS = path.join(STATE_DIR, "logs");
const PORTS_FILE = path.join(STATE_DIR, "ports.json");
// Never part of a design's change, in any design folder (the app copy's own exclude list).
const EXCLUDE = ["/CLAUDE.local.md", "/.liveframe/", "/.claude/settings.local.json"];

const LABELS = {
  "setting-up": "Setting up the design's folder",
  installing: "Installing the app's packages (the first time takes a minute or two)",
  starting: "Starting the app (about half a minute)",
  ready: "Running",
  failed: "Couldn't start",
  stopped: "Not running",
};

// ---------- what's in the design repo ----------

const projectDir = (id) => path.join(DESIGN_REPO, "projects", id);
const rel = (id, ...parts) => path.posix.join("projects", id, ...parts);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export const metaOf = (id) => readJson(path.join(projectDir(id), "project.json")) ?? {};

export function writeMeta(id, meta) {
  fs.writeFileSync(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2) + "\n");
}

export function checkId(id) {
  if (!ID.test(id ?? "") || !fs.existsSync(path.join(projectDir(id), "project.json"))) throw new HttpError(404, "no_project", "There's no such design.");
}

export const folderOf = (id) => path.join(DESIGNS_DIR, id);
export const branchOf = (id) => `design/${id}`;

/** The design's change as saved in the design repo ("" when nothing changed yet). */
export const patchOf = (id) => {
  try {
    return fs.readFileSync(path.join(projectDir(id), "changes.patch"), "utf8");
  } catch {
    return "";
  }
};
export const patchHash = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);

/** Published versions, oldest first: projects/<id>/v<n>/version.json. */
export function versionsOf(id) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectDir(id), { withFileTypes: true }).filter((d) => d.isDirectory() && /^v\d+$/.test(d.name));
  } catch {}
  return dirs
    .map((d) => ({ n: Number(d.name.slice(1)), ...(readJson(path.join(projectDir(id), d.name, "version.json")) ?? {}) }))
    .sort((a, b) => a.n - b.n);
}

export const screensOf = (id) => (Array.isArray(metaOf(id).screens) ? metaOf(id).screens : []).filter((s) => s?.route && s?.page);

async function lastSaveAt(id) {
  return (await git(["log", "-1", "--format=%cI", "--", rel(id)])).stdout.trim() || null;
}

export async function summary(id) {
  const meta = metaOf(id);
  const versions = versionsOf(id);
  const last = versions.at(-1) ?? null;
  const patch = patchOf(id);
  const me = await whoAmI();
  return {
    id,
    title: meta.title || id,
    brief: meta.brief ?? "",
    designer: meta.designer ?? null,
    designerLogin: meta.designerLogin ?? null,
    designerLabel: labelOf(meta.designer, meta.designerLogin),
    mine: isMine(meta, me),
    copiedFrom: meta.copiedFrom ?? null,
    createdAt: meta.createdAt ?? null,
    status: meta.status ?? "designing",
    ready: meta.ready ?? null,
    pr: meta.pr ?? null,
    archivedAt: meta.archivedAt ?? null,
    base: meta.base ?? null,
    ideas: meta.ideas ?? null,
    screens: screensOf(id),
    layout: meta.layout ?? {},
    links: Array.isArray(meta.links) ? meta.links : [],
    versions,
    latestVersion: last,
    changed: patch.trim().length > 0,
    unpublished: !last || last.patch !== patchHash(patch) || new Set((last.screens ?? []).map((x) => x.page)).size !== screensOf(id).length,
    savedAt: (await lastSaveAt(id)) ?? meta.createdAt ?? null,
  };
}

export async function listDesigns() {
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(DESIGN_REPO, "projects"), { withFileTypes: true }).filter((d) => d.isDirectory() && ID.test(d.name) && fs.existsSync(path.join(projectDir(d.name), "project.json"))).map((d) => d.name);
  } catch {}
  const all = await Promise.all(ids.map(summary));
  return all.sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")));
}

/** "Simpler sign-up" → "simpler-sign-up": the design's folder name. */
export function folderName(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

/** The app's latest commit on its main line, as this Mac's copy has it. */
export const appHead = async () => gitOk(["rev-parse", `refs/remotes/origin/${profile().branch}`], { cwd: APP_REPO }).catch(() => gitOk(["rev-parse", profile().branch], { cwd: APP_REPO }));

/** New design: its project.json, saved and shared. Its folder is made when it's first opened. */
export async function createDesign(name, brief) {
  const title = String(name ?? "").trim().slice(0, 80);
  const id = folderName(title);
  if (!title || !ID.test(id)) throw new HttpError(400, "bad_name", "Give the design a name with letters or numbers.");
  if (fs.existsSync(projectDir(id))) throw new HttpError(409, "taken", `There's already a design called ${title}.`);
  const me = await whoAmI();
  const meta = { title, brief: String(brief ?? "").trim().slice(0, 2000), designer: me.name, designerLogin: me.login, createdAt: new Date().toISOString(), base: await appHead(), screens: [], status: "designing" };
  fs.mkdirSync(projectDir(id), { recursive: true });
  writeMeta(id, meta);
  fs.writeFileSync(path.join(projectDir(id), "journal.md"), startJournal(meta));
  await inOrder(() => commitPaths([rel(id)], `Start design: ${title}`));
  pushSoon();
  return summary(id);
}

function startJournal(meta) {
  const today = new Date().toISOString().slice(0, 10);
  return `# ${meta.title}

**Brief:** ${meta.brief || "(not written yet: ask the designer)"}
**Designer:** ${labelOf(meta.designer, meta.designerLogin) || "(unknown)"}${meta.copiedFrom ? `\n**Copied from:** “${meta.copiedFrom.title}” by ${meta.copiedFrom.designer || "someone"}${meta.copiedFrom.version ? ` (its v${meta.copiedFrom.version})` : " (its latest save)"}` : ""}

## Where it stands

Started. Nothing changed yet.

## Open questions

- (none yet)

## ${today}

- Liveframe started the design.
`;
}

/** Only the design's designer works on it; anyone else makes their own copy. Throws for others. */
export async function mustBeMine(id) {
  const meta = metaOf(id);
  if (isMine(meta, await whoAmI())) return;
  throw new HttpError(403, "not_yours", `This is ${labelOf(meta.designer, meta.designerLogin) ?? "someone else"}'s design. Make your own copy to work on it.`);
}

/**
 * My own copy of someone else's design: a new design that starts where theirs is (the same app
 * commit, change, screens and ideas), with its own journal saying where it came from.
 */
export async function copyDesign(id, name) {
  checkId(id);
  const from = metaOf(id);
  const me = await whoAmI();
  const firstName = (me.name || me.login || "my").split(" ")[0];
  let title = String(name ?? "").trim().slice(0, 80) || `${from.title || id} (${firstName}'s copy)`;
  let newId = folderName(title);
  for (let i = 2; fs.existsSync(projectDir(newId)); i++) newId = folderName(`${title} ${i}`), (title = `${String(name ?? "").trim() || `${from.title || id} (${firstName}'s copy)`} ${i}`);
  const last = versionsOf(id).at(-1);
  const meta = {
    title,
    brief: from.brief ?? "",
    designer: me.name,
    designerLogin: me.login,
    createdAt: new Date().toISOString(),
    base: from.base,
    screens: from.screens ?? [],
    ...(from.ideas ? { ideas: from.ideas } : {}),
    status: "designing",
    copiedFrom: { id, title: from.title || id, designer: labelOf(from.designer, from.designerLogin), version: last && last.patch === patchHash(patchOf(id)) ? last.n : null },
  };
  fs.mkdirSync(projectDir(newId), { recursive: true });
  writeMeta(newId, meta);
  fs.writeFileSync(path.join(projectDir(newId), "changes.patch"), patchOf(id));
  fs.writeFileSync(path.join(projectDir(newId), "journal.md"), startJournal(meta).replace("- Liveframe started the design.", `- Liveframe started this design as a copy of “${meta.copiedFrom.title}” by ${meta.copiedFrom.designer || "someone"}: the same change, screens${from.ideas ? " and ideas" : ""}. Its journal is at projects/${id}/journal.md.`));
  await inOrder(() => commitPaths([rel(newId)], `Copy design: ${title} (from ${from.title || id})`));
  pushSoon();
  return summary(newId);
}

/** Add a screen to the design's canvas: an app page by its address, named as the designer calls it. */
export async function addScreen(id, name, route) {
  checkId(id);
  const title = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const where = String(route ?? "").trim();
  if (!title) throw new HttpError(400, "no_name", "Give the screen a name.");
  if (!/^\/[^\s"<>]*$/.test(where) || where.startsWith("//")) throw new HttpError(400, "bad_route", "A screen is an app page's address, like /orders.");
  const page = folderName(title) || "screen";
  const meta = metaOf(id);
  const screens = Array.isArray(meta.screens) ? meta.screens : [];
  const same = screens.find((s) => s.page === page);
  if (same && same.route !== where) throw new HttpError(409, "taken", `There's already a screen called ${title}.`);
  if (!same) screens.push({ page, name: title, route: where });
  meta.screens = screens;
  writeMeta(id, meta);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Screen: ${title} (${where})`));
  pushSoon();
  notify({ type: "changed", project: id });
  return { page, name: title, route: where };
}

/**
 * The canvas: which screens it has, where they were moved to, and the arrows between them. Any of
 * the three (undo sends the earlier ones back). Removing a screen also removes its place and arrows.
 */
export async function setCanvas(id, { screens, layout, links }) {
  checkId(id);
  const meta = metaOf(id);
  const changed = [];
  if (screens !== undefined) {
    if (!Array.isArray(screens) || screens.some((s) => !s || typeof s.page !== "string" || typeof s.route !== "string" || !/^\//.test(s.route))) throw new HttpError(400, "bad_screens", "Screens are { page, name, route }.");
    const before = new Set((meta.screens ?? []).map((s) => s.page));
    meta.screens = screens.map((s) => ({ page: s.page, name: String(s.name ?? s.page).slice(0, 80), route: s.route }));
    const gone = [...before].filter((pg) => !meta.screens.some((s) => s.page === pg));
    if (gone.length) changed.push(`removed ${gone.join(", ")}`);
    else if (meta.screens.length > before.size) changed.push("screens back");
  }
  if (layout !== undefined) {
    if (!layout || typeof layout !== "object") throw new HttpError(400, "bad_layout", "The layout is { page: { x, y } }.");
    meta.layout = Object.fromEntries(Object.entries(layout).filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(([pg, p]) => [pg, { x: Math.round(p.x), y: Math.round(p.y) }]));
    changed.push(Object.keys(meta.layout).length ? "moved screens" : "tidied up");
  }
  if (links !== undefined) {
    if (!Array.isArray(links)) throw new HttpError(400, "bad_links", "Arrows are [{ from, to }].");
    meta.links = links.filter((l) => typeof l?.from === "string" && typeof l?.to === "string" && l.from !== l.to).map((l) => ({ from: l.from, to: l.to }));
    changed.push("arrows");
  }
  // Nothing left pointing at a screen that's gone.
  const pages = new Set((meta.screens ?? []).map((s) => s.page));
  if (meta.layout) meta.layout = Object.fromEntries(Object.entries(meta.layout).filter(([pg]) => pages.has(pg)));
  if (meta.links) meta.links = meta.links.filter((l) => pages.has(l.from) && pages.has(l.to));
  writeMeta(id, meta);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Canvas: ${meta.title || id} (${changed.join("; ") || "no change"})`));
  pushSoon();
  notify({ type: "changed", project: id });
  return summary(id);
}

/** Rename the design or one of its screens. */
export async function rename(id, what, value) {
  checkId(id);
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!text) throw new HttpError(400, "empty_name", "Give it a name.");
  const meta = metaOf(id);
  if (what?.title) meta.title = text;
  else if (what?.page) {
    const s = (meta.screens ?? []).find((x) => x.page === what.page);
    if (!s) throw new HttpError(404, "no_page", "There's no such screen.");
    s.name = text;
  } else throw new HttpError(400, "bad_rename", "Say what to rename.");
  writeMeta(id, meta);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Rename: ${text}`));
  pushSoon();
  return { ok: true };
}

// ---------- the design's folder ----------

const inFolder = (id) => ({ cwd: folderOf(id) });

/** The app copy's exclude list has Liveframe's own files (it applies to every worktree). */
async function excludeKit() {
  const common = await gitOk(["rev-parse", "--git-common-dir"], { cwd: APP_REPO });
  const file = path.resolve(APP_REPO, common, "info", "exclude");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = EXCLUDE.filter((l) => !have.split("\n").includes(l));
  if (missing.length) fs.appendFileSync(file, `${have && !have.endsWith("\n") ? "\n" : ""}# Liveframe\n${missing.join("\n")}\n`);
}

/** Make sure the app copy has this commit (a design started on another Mac may be newer). */
async function haveCommit(sha) {
  if ((await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: APP_REPO })).code === 0) return;
  await gitOk(["fetch", "-q", "origin"], { cwd: APP_REPO });
  if ((await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: APP_REPO })).code !== 0) throw new Error(`The app copy doesn't have ${sha.slice(0, 8)}, the commit this design started from.`);
}

/** The design's folder, made the first time (from base and changes.patch), with the kit written in. */
async function makeFolder(id) {
  const meta = metaOf(id);
  const dir = folderOf(id);
  const branch = branchOf(id);
  await excludeKit();
  if (!fs.existsSync(path.join(dir, ".git"))) {
    if (!meta.base) throw new Error("This design doesn't say which app commit it started from.");
    await haveCommit(meta.base);
    fs.mkdirSync(DESIGNS_DIR, { recursive: true });
    await git(["worktree", "prune"], { cwd: APP_REPO });
    const exists = (await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: APP_REPO })).code === 0;
    if (exists) await gitOk(["worktree", "add", "-q", dir, branch], { cwd: APP_REPO });
    else await gitOk(["worktree", "add", "-q", "-b", branch, dir, meta.base], { cwd: APP_REPO });
    // A design saved on another Mac: bring its change in.
    const patch = patchOf(id);
    const ahead = (await gitOk(["rev-list", "--count", `${meta.base}..HEAD`], inFolder(id))) !== "0";
    if (patch.trim() && !ahead) {
      await gitOk(["apply", "--binary", "--index", "--whitespace=nowarn"], { ...inFolder(id), input: patch });
      await gitOk(["commit", "-q", "-m", "The design so far (from the design repo)"], inFolder(id));
    }
  }
  writeKit(id);
  // The journal: Claude keeps it in the folder; the design repo's copy is the shared one.
  const journal = path.join(dir, ".liveframe", "journal.md");
  if (!fs.existsSync(journal)) {
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.copyFileSync(path.join(projectDir(id), "journal.md"), journal);
  }
  watchFolder(id);
  return dir;
}

/** Liveframe's rules for Claude in this folder (kit/), filled in for this design. */
function writeKit(id) {
  const p = profile();
  const meta = metaOf(id);
  const values = {
    DESIGN: id,
    TITLE: String(meta.title || id).replace(/[`$\\]/g, ""),
    APP: p.name,
    LIVEFRAME_URL: `http://localhost:${PORT}`,
    APP_URL: urlOf(id),
    FRONTEND: p.frontend.length ? p.frontend.map((f) => `\`${f}\``).join(", ") : "the app's frontend code",
    BACKEND: p.backend.length ? p.backend.map((f) => `\`${f}\``).join(", ") : "(none named)",
    TOKENS: p.designSystem.tokens.map((f) => `\`${f}\``).join(", ") || "(none named)",
    COMPONENTS: p.designSystem.components.map((f) => `\`${f}/\``).join(", ") || "(none named)",
    NOTES: p.notes || "(none)",
    SCREENS: screensOf(id).map((s) => `${s.name} (\`${s.route}\`)`).join(", ") || "none yet",
    PAGES: p.pages.map((pg) => `${pg.name} (\`${pg.route}\`)`).join(", ") || "(none listed)",
  };
  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        copy(src, dst);
        continue;
      }
      const text = fill(fs.readFileSync(src, "utf8"), values);
      if (!fs.existsSync(dst) || fs.readFileSync(dst, "utf8") !== text) fs.writeFileSync(dst, text);
    }
  };
  copy(KIT, folderOf(id));
}

/** The design's folder, made or brought up to date (Design with Claude opens a session in it). */
export const ensureFolder = (id) => serial(async () => {
  const dir = await makeFolder(id);
  await updateFromApp(id).catch((e) => console.error(`[update ${id}] ${e.message}`));
  return dir;
});

/**
 * Bring the design onto the app's latest (when it's opened, never mid-work, and not once it's with
 * engineering): its change is replayed on the app's latest. A clash leaves it as it was, and the
 * journal says an update is waiting, so Claude sorts it out at the start of the next session.
 * Returns { updated, clash }.
 */
async function updateFromApp(id) {
  const meta = metaOf(id);
  if (meta.status && meta.status !== "designing") return { updated: false };
  const head = await appHead();
  if (!meta.base || meta.base === head) return { updated: false };
  await save(id);
  const dir = inFolder(id);
  const r = await git(["rebase", "-q", "--onto", head, meta.base, branchOf(id)], dir);
  const journal = path.join(folderOf(id), ".liveframe", "journal.md");
  const today = new Date().toISOString().slice(0, 10);
  if (r.code !== 0) {
    await git(["rebase", "--abort"], dir);
    if (meta.update?.waiting !== head) {
      meta.update = { waiting: head, clash: true, at: new Date().toISOString() };
      writeMeta(id, meta);
      fs.appendFileSync(journal, `\n## ${today}\n\n- **Update waiting:** ${profile().name} changed in the same places as this design (app commit ${head.slice(0, 8)}). Claude: bring the design onto it (\`git rebase --onto ${head} ${meta.base}\`, resolve the clash keeping the design's intent, then tell the designer what changed). Liveframe saves it afterwards.\n`);
      await inOrder(() => commitPaths([rel(id, "project.json")], `Update waiting: ${meta.title || id}`));
    }
    return { updated: false, clash: true };
  }
  const old = meta.base;
  meta.base = head;
  delete meta.update;
  writeMeta(id, meta);
  fs.appendFileSync(journal, `\n## ${today}\n\n- Liveframe brought the design onto ${profile().name}'s latest (${old.slice(0, 8)} → ${head.slice(0, 8)}).\n`);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Update: ${meta.title || id} onto ${head.slice(0, 8)}`));
  await save(id);
  return { updated: true };
}

/** After Claude sorted out a clash itself: the folder's branch now sits on the app's latest. */
export async function noticeRebase(id) {
  const meta = metaOf(id);
  if (!meta.update?.waiting || !fs.existsSync(path.join(folderOf(id), ".git"))) return;
  const onIt = (await git(["merge-base", "--is-ancestor", meta.update.waiting, "HEAD"], inFolder(id))).code === 0;
  if (!onIt) return;
  meta.base = meta.update.waiting;
  delete meta.update;
  writeMeta(id, meta);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Update: ${meta.title || id} onto ${meta.base.slice(0, 8)}`));
}

// ---------- saving ----------

const watchers = new Map();
const saveTimers = new Map();
// The design's own code and its journal; not packages, build output, local data or git.
const IGNORE = /(^|\/)(node_modules|\.next|\.turbo|\.data|\.git|dist|build|out)(\/|$)|\.log$|(^|\/)\.DS_Store$|\.tsbuildinfo$/;

function watchFolder(id) {
  if (watchers.has(id)) return;
  try {
    const w = fs.watch(folderOf(id), { recursive: true }, (_t, file) => {
      const f = String(file ?? "").split(path.sep).join("/");
      if (!f || IGNORE.test(f) || f === "CLAUDE.local.md") return;
      clearTimeout(saveTimers.get(id));
      saveTimers.set(id, setTimeout(() => save(id).catch((e) => console.error(`[save ${id}] ${e.message}`)), 4000));
    });
    w.on("error", () => watchers.delete(id));
    watchers.set(id, w);
  } catch {}
}

export function stopWatching() {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}

/** Save the design: commit its folder, write its change and journal to the design repo, share it. */
export async function save(id) {
  const meta = metaOf(id);
  if (meta.status === "archived" || !fs.existsSync(path.join(folderOf(id), ".git"))) return false;
  const dir = inFolder(id);
  // Not in the middle of a rebase (Claude sorting out an update): save once it's done.
  const gitDir = await gitOk(["rev-parse", "--git-dir"], dir);
  if (["rebase-merge", "rebase-apply", "MERGE_HEAD"].some((f) => fs.existsSync(path.resolve(folderOf(id), gitDir, f)))) return false;
  await noticeRebase(id);
  const base = metaOf(id).base;
  await gitOk(["add", "-A"], dir);
  if ((await git(["diff", "--cached", "--quiet"], dir)).code !== 0) await gitOk(["commit", "-q", "-m", "Save"], dir);
  const patch = await gitOk(["diff", "--binary", base, "HEAD"], { ...dir, raw: true });
  const journal = path.join(folderOf(id), ".liveframe", "journal.md");
  const committed = await inOrder(async () => {
    fs.writeFileSync(path.join(projectDir(id), "changes.patch"), patch);
    if (fs.existsSync(journal)) fs.copyFileSync(journal, path.join(projectDir(id), "journal.md"));
    // The design's ideas, if it has any, so the canvas and Publish know them on any Mac.
    const m = metaOf(id);
    const ideas = readIdeas(folderOf(id));
    if (JSON.stringify(m.ideas ?? null) !== JSON.stringify(ideas)) {
      if (ideas) m.ideas = ideas;
      else delete m.ideas;
      writeMeta(id, m);
    }
    return commitPaths([rel(id, "changes.patch"), rel(id, "journal.md"), rel(id, "project.json")], `Save: ${meta.title || id}`);
  });
  if (committed) {
    pushSoon();
    notify({ type: "saved", project: id });
  }
  return committed;
}

// ---------- ports ----------

/** The design's two ports, given once and kept (screens and Claude's sessions know them). */
export function portsOf(id) {
  const all = readJson(PORTS_FILE) ?? {};
  if (!all[id]) {
    const used = new Set(Object.values(all).map((p) => p.app));
    let base = APP_PORTS.first;
    while (used.has(base)) base += 2;
    if (base + 1 > APP_PORTS.last) throw new Error(`No ports left for designs' apps (${APP_PORTS.first}–${APP_PORTS.last}).`);
    all[id] = { app: base, proxy: base + 1 };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(PORTS_FILE, JSON.stringify(all, null, 2) + "\n");
  }
  return all[id];
}

/** Where the design's app opens (its proxy: signed in, frameable). */
export const urlOf = (id) => `http://localhost:${portsOf(id).proxy}`;

// ---------- running the app ----------

const designs = new Map(); // id → Run

function view(id, s) {
  const state = s?.state ?? "stopped";
  return { id, state, label: LABELS[state], error: s?.error ?? null, url: urlOf(id), folder: folderOf(id), branch: branchOf(id), log: logFile(id) };
}

export const statusOf = (id) => view(id, designs.get(id));

/** Someone is looking at the design (its canvas, a screen, Claude). */
export function touch(id) {
  const s = designs.get(id);
  if (s) s.lastActive = Date.now();
}

/** Make sure the design's app runs. Returns its status right away; it gets to "ready" by itself. */
export function ensureRunning(id) {
  let s = designs.get(id);
  if (s && ["setting-up", "installing", "starting", "ready"].includes(s.state)) {
    s.lastActive = Date.now();
    return view(id, s);
  }
  if (s && s.state === "failed" && Date.now() - s.failedAt < 15_000) return view(id, s);
  if (metaOf(id).status === "archived") return view(id, { state: "stopped" });
  s = { id, state: "setting-up", error: null, failedAt: 0, lastActive: Date.now(), procs: [], proxy: null };
  designs.set(id, s);
  start(s).catch((e) => fail(s, e.message));
  return view(id, s);
}

/** Wait until the design's app is ready (or failed). */
export async function whenReady(id, ms = 6 * 60_000) {
  ensureRunning(id);
  const until = Date.now() + ms;
  for (;;) {
    const s = statusOf(id);
    if (s.state === "ready") return s;
    if (s.state === "failed") throw new Error(s.error ?? "The design's app couldn't start.");
    if (Date.now() > until) throw new Error("The design's app didn't start in time.");
    await sleep(1000);
  }
}

async function start(s) {
  const { id } = s;
  makeRoom(s);
  const step = (state) => {
    if (s.state !== "stopped") s.state = state;
    notify({ type: "app", project: id });
  };
  const dir = await serial(() => prepare(id, step));
  if (s.state === "stopped") return;
  const p = profile();
  const ports = portsOf(id);
  step("starting");
  if (!(await portOpen(ports.app))) {
    const [cmd, ...args] = p.run.map((a) => fill(a, { port: ports.app }));
    const env = Object.fromEntries(Object.entries(p.env).map(([k, v]) => [k, fill(v, { port: ports.app })]));
    spawnLogged(s, cmd.startsWith(".") || cmd.includes("/") ? path.resolve(dir, cmd) : cmd, args, dir, { PORT: String(ports.app), NEXT_TELEMETRY_DISABLED: "1", ...env });
  }
  if (!s.proxy && !(await portOpen(ports.proxy))) s.proxy = await startProxy({ port: ports.proxy, appPort: ports.app, cookie: p.signIn.cookie, folder: dir, touch: () => touch(id) });

  // Ready once the app's ready page answers (the first compile takes a while).
  const deadline = Date.now() + 6 * 60_000;
  while (s.state === "starting") {
    if (await answers(`http://127.0.0.1:${ports.app}${screensOf(id)[0]?.route ?? p.ready}`, 180_000, p.signIn.cookie)) {
      if (s.state === "starting") {
        s.state = "ready";
        log(id, `ready on ${ports.proxy}`);
        notify({ type: "app", project: id });
      }
      return;
    }
    if (Date.now() > deadline) throw new Error("The app didn't answer within 6 minutes.");
    await sleep(1000);
  }
}

/** The folder, and the app's packages (once, and again when the lockfile changes). */
async function prepare(id, step) {
  step("setting-up");
  const dir = await makeFolder(id);
  const p = profile();
  if (p.install.length) {
    const lockFile = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    const lock = lockFile ? crypto.createHash("sha1").update(fs.readFileSync(lockFile)).digest("hex") : "none";
    const marker = path.join(dir, "node_modules", ".liveframe-installed");
    if (readJson(marker)?.lock !== lock) {
      step("installing");
      const [cmd, ...args] = p.install;
      await runLogged(id, cmd, args, dir);
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, JSON.stringify({ lock, at: new Date().toISOString() }) + "\n");
    }
  }
  return dir;
}

function logFile(id) {
  fs.mkdirSync(LOGS, { recursive: true });
  return path.join(LOGS, `${id}.log`);
}

function runLogged(id, cmd, args, cwd) {
  const out = fs.openSync(logFile(id), "a");
  fs.writeSync(out, `\n[liveframe ${new Date().toISOString()}] ${cmd} ${args.join(" ")} (in ${cwd})\n`);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, CI: "1", HUSKY: "0" }, stdio: ["ignore", out, out] });
    fs.closeSync(out);
    p.on("error", (e) => reject(new Error(`couldn't run ${cmd}: ${e.message}`)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0] ?? ""} failed (exit ${code}); see ${logFile(id)}`))));
  });
}

function spawnLogged(s, cmd, args, cwd, env) {
  const out = fs.openSync(logFile(s.id), "a");
  fs.writeSync(out, `\n[liveframe ${new Date().toISOString()}] starting: ${cmd} ${args.join(" ")} (in ${cwd})\n`);
  const proc = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
  fs.closeSync(out);
  s.procs.push(proc);
  running.add(proc);
  proc.on("error", (e) => fail(s, `couldn't start ${path.basename(cmd)}: ${e.message}`));
  proc.on("exit", (code, signal) => {
    running.delete(proc);
    if (s.state !== "stopped") fail(s, `${path.basename(cmd)} stopped (${signal || `exit code ${code}`}); see ${logFile(s.id)}`);
  });
}

function fail(s, message) {
  if (s.state === "stopped" || s.state === "failed") return;
  log(s.id, `failed: ${message}`);
  halt(s);
  s.state = "failed";
  s.failedAt = Date.now();
  s.error = message;
  notify({ type: "app", project: s.id });
}

function halt(s) {
  for (const p of s.procs) killTree(p.pid, "SIGTERM");
  const procs = s.procs;
  setTimeout(() => procs.forEach((p) => p.exitCode == null && p.signalCode == null && killTree(p.pid, "SIGKILL")), 5000).unref();
  s.procs = [];
  s.proxy?.close();
  s.proxy?.closeAllConnections?.();
  s.proxy = null;
}

function stop(s) {
  if (s.state === "stopped") return;
  s.state = "stopped";
  halt(s);
  if (designs.get(s.id) === s) designs.delete(s.id);
  log(s.id, "stopped");
}

export function stopApp(id) {
  const s = designs.get(id);
  if (s) stop(s);
}

export function stopAllApps() {
  for (const s of [...designs.values()]) stop(s);
}

function makeRoom(except) {
  const on = [...designs.values()].filter((s) => s !== except && s.state !== "failed" && s.state !== "stopped").sort((a, b) => a.lastActive - b.lastActive);
  while (on.length >= MAX_RUNNING) stop(on.shift());
}

setInterval(() => {
  const now = Date.now();
  for (const s of [...designs.values()]) {
    if (s.state === "failed") {
      if (now - s.failedAt > 60_000) designs.delete(s.id);
    } else if (now - s.lastActive > IDLE_MS) stop(s);
  }
}, 60_000).unref();

// ---------- archive ----------

/** Archive: read-only from now on; its folder, branch and packages leave this Mac. */
export async function archive(id, why) {
  stopApp(id);
  watchers.get(id)?.close();
  watchers.delete(id);
  const meta = metaOf(id);
  meta.status = "archived";
  meta.archivedAt = new Date().toISOString();
  writeMeta(id, meta);
  await inOrder(() => commitPaths([rel(id, "project.json")], `Archive ${meta.title || id}: ${why}`));
  pushSoon();
  await removeFolder(id);
  notify({ type: "changed", project: id });
}

export async function removeFolder(id) {
  const dir = folderOf(id);
  if (fs.existsSync(dir)) {
    await git(["worktree", "remove", "--force", dir], { cwd: APP_REPO });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], { cwd: APP_REPO });
  await git(["branch", "-D", branchOf(id)], { cwd: APP_REPO });
}

// ---------- helpers ----------

let queue = Promise.resolve();
function serial(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

const running = new Set();
process.on("exit", () => {
  for (const proc of running) killTree(proc.pid, "SIGKILL");
});

/** Signal a process and everything under it (dev servers start workers). */
function killTree(pid, signal) {
  if (!pid) return;
  const kids = new Map();
  try {
    for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).split("\n")) {
      const [p, pp] = line.trim().split(/\s+/).map(Number);
      if (p && pp) kids.set(pp, [...(kids.get(pp) ?? []), p]);
    }
  } catch {}
  const all = [];
  const walk = (p) => (all.push(p), (kids.get(p) ?? []).forEach(walk));
  walk(pid);
  for (const p of all) {
    try {
      process.kill(p, signal);
    } catch {}
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.setTimeout(1000);
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => (sock.destroy(), resolve(false)));
  });
}

/** Does the app answer at `url` (any status: the first request waits for the page to compile)? */
async function answers(url, ms, cookie) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "manual", headers: cookie ? { cookie } : {} });
    return true;
  } catch {
    return false;
  }
}

function log(id, text) {
  console.log(`[app ${id}] ${text}`);
  try {
    fs.appendFileSync(logFile(id), `[liveframe ${new Date().toISOString()}] ${text}\n`);
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
