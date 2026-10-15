// Keeping up (every few minutes, and when Liveframe starts):
//   - the app copy follows the app on GitHub (it's only ever read, so it just moves forward)
//   - the design system updates the pages a change to the tokens or components touched
//   - the design repo brings in what other designers shared
//   - a design that's with engineering is archived once its pull request is merged
// Designs themselves take the app's changes when they're opened (designs.mjs, updateFromApp).

import { execFile } from "node:child_process";
import { APP_REPO, CHECK_MS } from "./config.mjs";
import { git } from "./git.mjs";
import { pushNow } from "./git.mjs";
import { profile, hasProfile } from "./profile.mjs";
import { updateDesignSystem } from "./design-system.mjs";
import { listDesigns, metaOf, writeMeta, branchOf, archive } from "./designs.mjs";
import { inOrder, commitPaths } from "./git.mjs";
import { writeSite } from "./site.mjs";
import { notify } from "./events.mjs";

let last = { at: null, app: null, designSystem: null, error: null };
export const keepingUp = () => last;

/** "https://github.com/lumen/lumen-books(.git)" → "lumen/lumen-books". */
const slugOf = (repo) => /github\.com[/:]([^/]+\/[^/.]+)/.exec(repo ?? "")?.[1] ?? null;

function gh(args) {
  return new Promise((resolve) => execFile("gh", args, { timeout: 30_000 }, (err, stdout) => resolve(err ? null : stdout)));
}

/** The app copy: fetch, and move its main line forward (never anything else: it's read-only). */
async function followApp() {
  const p = profile();
  const r = await git(["fetch", "-q", "--prune", "origin"], { cwd: APP_REPO });
  if (r.code !== 0) throw new Error(`Couldn't reach the app on GitHub: ${r.stderr.trim()}`);
  const current = (await git(["symbolic-ref", "--short", "HEAD"], { cwd: APP_REPO })).stdout.trim();
  if (current === p.branch) await git(["merge", "-q", "--ff-only", `origin/${p.branch}`], { cwd: APP_REPO });
  else await git(["branch", "-f", p.branch, `origin/${p.branch}`], { cwd: APP_REPO });
  return (await git(["rev-parse", `origin/${p.branch}`], { cwd: APP_REPO })).stdout.trim();
}

/** Designs with engineering: their pull request (found by branch), and archived once it's merged. */
async function followHandoffs() {
  const repo = slugOf(profile().repo);
  if (!repo) return;
  for (const d of await listDesigns()) {
    if (d.status !== "ready") continue;
    const out = await gh(["pr", "list", "--repo", repo, "--head", branchOf(d.id), "--state", "all", "--json", "url,state,mergedAt", "--limit", "1"]);
    const pr = out ? JSON.parse(out)[0] : null;
    if (!pr) continue;
    const meta = metaOf(d.id);
    if (meta.pr !== pr.url) {
      meta.pr = pr.url;
      writeMeta(d.id, meta);
      await inOrder(async () => {
        await writeSite();
        await commitPaths([`projects/${d.id}`, "index.html"], `Pull request for ${meta.title}: ${pr.url}`);
      });
      notify({ type: "changed", project: d.id });
    }
    if (pr.state === "MERGED") await archive(d.id, `merged in ${pr.url}`);
  }
  await inOrder(async () => {
    if (await writeSite().then((w) => w.length)) await commitPaths(["index.html", "projects", "liveframe"], "Online pages");
  });
}

let running = false;
export async function keepUp() {
  if (running || !hasProfile()) return last;
  running = true;
  try {
    const app = await followApp();
    const ds = await updateDesignSystem();
    await followHandoffs();
    await pushNow();
    last = { at: new Date().toISOString(), app, designSystem: { changed: ds.changed.length, removed: ds.removed.length }, error: null };
    if (ds.committed) notify({ type: "design-system" });
  } catch (e) {
    last = { ...last, at: new Date().toISOString(), error: e.message };
    console.error(`[keep up] ${e.message}`);
  } finally {
    running = false;
  }
  return last;
}

export function startKeepingUp() {
  keepUp();
  setInterval(keepUp, CHECK_MS).unref();
}
