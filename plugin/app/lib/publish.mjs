// Publish: the design's screens, saved as plain pages in the design repo and shared, so reviewers
// see them online.
//
//   projects/<id>/v<n>/version.json   { n, name, at, designer, base, patch, screens: [{ page, name, route, file, picture }] }
//   projects/<id>/v<n>/<page>.html    each screen as it rendered (lib/snapshot.mjs)
//   projects/<id>/v<n>/<page>.jpg     a picture of it, for the version's and the site's covers
//   projects/<id>/v<n>/index.html     the version: its screens

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO } from "./config.mjs";
import { inOrder, commitPaths, pushNow, git } from "./git.mjs";
import { profile } from "./profile.mjs";
import { checkId, metaOf, save, summary, versionsOf, patchOf, patchHash, whenReady, statusOf, screensOf } from "./designs.mjs";
import { snapshot } from "./snapshot.mjs";
import { takePicture } from "./pictures.mjs";
import { writeSite, sitePage, esc } from "./site.mjs";
import { HttpError } from "./http.mjs";
import { notify } from "./events.mjs";

let publishing = new Set();

/** The small bar on every saved screen: back to the version, and the other screens. */
function screenBar(title, n, name, screens, i) {
  const prev = screens[i - 1];
  const next = screens[i + 1];
  const a = "all:unset;cursor:pointer;color:#fff;opacity:.9;padding:0 6px";
  return `<div style="all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:rgba(22,24,29,.88);color:#fff;font:500 12px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)">
<a style="${a}" href="index.html">${esc(title)} · v${n}</a><span style="opacity:.4">|</span>
${prev ? `<a style="${a}" href="${esc(prev.file)}" title="${esc(prev.name)}">‹</a>` : `<span style="opacity:.3;padding:0 6px">‹</span>`}
<span style="padding:0 2px">${esc(screens[i].name)} · ${i + 1} of ${screens.length}</span>
${next ? `<a style="${a}" href="${esc(next.file)}" title="${esc(next.name)}">›</a>` : `<span style="opacity:.3;padding:0 6px">›</span>`}
</div>`;
}

function versionPage(id, v, title) {
  const here = `projects/${id}/v${v.n}/index.html`;
  const body = `<h1>${esc(title)} · v${v.n}</h1>
<p class="lead">${esc(v.name)} · published ${esc(new Date(v.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}${v.designer ? ` by ${esc(v.designer)}` : ""}</p>
<ul class="screens">${v.screens.map((s) => `<li><a class="card" href="${esc(s.file)}"><div class="card__cover">${s.picture ? `<img src="${esc(s.picture)}" alt="">` : ""}</div><div class="card__body"><strong>${esc(s.name)}</strong><span>${esc(s.route)}</span></div></a></li>`).join("")}</ul>`;
  return sitePage(here, { title: `${title} · v${v.n}`, crumbs: [[`projects/${id}/index.html`, title], [null, `v${v.n}`]], body });
}

/** Publish the design's latest as the next version. */
export async function publish(id, name) {
  checkId(id);
  const meta = metaOf(id);
  if (meta.status === "archived") throw new HttpError(409, "archived", "This design is archived.");
  if (meta.status === "ready") throw new HttpError(409, "with_engineering", "This design is with engineering.");
  if (publishing.has(id)) throw new HttpError(409, "busy", "Already publishing this design.");
  const screens = screensOf(id);
  if (!screens.length) throw new HttpError(409, "no_screens", "This design has no screens yet.");
  publishing.add(id);
  try {
    await save(id);
    const s = await summary(id);
    if (!s.unpublished) throw new HttpError(409, "nothing_new", "Nothing has changed since the last version.");
    await whenReady(id);
    const n = (versionsOf(id).at(-1)?.n ?? 0) + 1;
    const label = String(name ?? "").trim().slice(0, 120) || (n === 1 ? "First look" : `Version ${n}`);
    const dir = `projects/${id}/v${n}`;
    const list = screens.map((sc) => ({ page: sc.page, name: sc.name, route: sc.route, file: `${sc.page}.html`, picture: `${sc.page}.jpg` }));
    const routes = Object.fromEntries(list.map((sc) => [sc.route, sc.file]));
    const url = statusOf(id).url;
    notify({ type: "publishing", project: id, done: 0, total: list.length });
    for (const [i, sc] of list.entries()) {
      await snapshot(url + sc.route, `${dir}/${sc.file}`, { routes, bar: screenBar(meta.title || id, n, label, list, i) });
      fs.writeFileSync(path.join(DESIGN_REPO, dir, sc.picture), await takePicture(url + sc.route, 1440, 900));
      notify({ type: "publishing", project: id, done: i + 1, total: list.length });
    }
    const designer = (await git(["config", "user.name"])).stdout.trim() || null;
    const v = { n, name: label, at: new Date().toISOString(), designer, base: meta.base, patch: patchHash(patchOf(id)), screens: list };
    fs.writeFileSync(path.join(DESIGN_REPO, dir, "version.json"), JSON.stringify(v, null, 2) + "\n");
    fs.writeFileSync(path.join(DESIGN_REPO, dir, "index.html"), versionPage(id, v, meta.title || id));
    await inOrder(async () => {
      await writeSite();
      await commitPaths([`projects/${id}`, "assets", "index.html", "liveframe"], `Publish ${meta.title || id} v${n}: ${label}`);
    });
    const push = await pushNow();
    notify({ type: "changed", project: id });
    return { version: { n, name: label }, pushed: !!push.ok, pushError: push.ok ? null : push.error, path: `${dir}/index.html` };
  } finally {
    publishing.delete(id);
  }
}

/** Where the site is online (the profile's "site", if set) — else null. */
export function siteUrl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DESIGN_REPO, "liveframe", "app.json"), "utf8")).site ?? null;
  } catch {
    return null;
  }
}

export { profile };
