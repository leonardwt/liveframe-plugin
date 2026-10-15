// Publish: the design's screens, saved as plain pages in the design repo and shared, so reviewers
// see them online.
//
//   projects/<id>/v<n>/version.json   { n, name, at, designer, base, patch, screens: [{ page, name, route, file, picture }] }
//   projects/<id>/v<n>/<page>.html    each screen as it rendered (lib/snapshot.mjs)
//   projects/<id>/v<n>/<page>.jpg     a picture of it, for the version's and the site's covers
//   projects/<id>/v<n>/<page>@phone.jpg  the same at phone size
//   projects/<id>/v<n>/index.html     → the version in the online Liveframe (site.mjs)

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO } from "./config.mjs";
import { inOrder, commitPaths, pushNow, git } from "./git.mjs";
import { profile } from "./profile.mjs";
import { checkId, metaOf, save, summary, versionsOf, patchOf, patchHash, whenReady, statusOf, screensOf } from "./designs.mjs";
import { capture } from "./snapshot.mjs";
import { withIdea } from "./pictures.mjs";
import { optionsOf } from "./ideas.mjs";
import { whoAmI } from "./identity.mjs";
import { writeSite, esc } from "./site.mjs";
import { HttpError } from "./http.mjs";
import { notify } from "./events.mjs";

let publishing = new Set();
// Screens saved at once: the design's dev server and Chrome both cope with a few in parallel.
const PARALLEL = Number(process.env.LIVEFRAME_PUBLISH_PARALLEL ?? 3);

/**
 * The small bar on every saved screen: back to the version, the other screens, and (with ideas) the
 * same screen on the other ideas. `shots`: this idea's screens; `others`: [{ name, file, on }].
 */
function screenBar(title, n, shots, i, others) {
  const prev = shots[i - 1];
  const next = shots[i + 1];
  const a = "all:unset;cursor:pointer;color:#fff;opacity:.9;padding:0 6px";
  const sep = `<span style="opacity:.4">|</span>`;
  const ideas = others.length
    ? `${sep}${others.map((o) => (o.on ? `<span style="padding:3px 8px;border-radius:999px;background:#3d5bff">${esc(o.name)}</span>` : `<a style="${a}" href="${esc(o.file)}">${esc(o.name)}</a>`)).join("")}`
    : "";
  return `<div style="all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:rgba(22,24,29,.88);color:#fff;font:500 12px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)">
<a style="${a}" href="index.html">${esc(title)} · v${n}</a>${sep}
${prev ? `<a style="${a}" href="${esc(prev.file)}" title="${esc(prev.name)}">‹</a>` : `<span style="opacity:.3;padding:0 6px">‹</span>`}
<span style="padding:0 2px">${esc(shots[i].name)} · ${i + 1} of ${shots.length}</span>
${next ? `<a style="${a}" href="${esc(next.file)}" title="${esc(next.name)}">›</a>` : `<span style="opacity:.3;padding:0 6px">›</span>`}
${ideas}
</div>`;
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
    // Each screen; with ideas, each screen on each idea ("Before" first).
    const ideas = metaOf(id).ideas ?? null;
    const options = optionsOf(ideas);
    const list = options.length
      ? options.flatMap((o) => screens.map((sc) => ({ page: sc.page, key: `${sc.page}~${o.id}`, name: sc.name, route: sc.route, idea: o.id, ideaName: o.name })))
      : screens.map((sc) => ({ page: sc.page, key: sc.page, name: sc.name, route: sc.route, idea: null }));
    for (const sc of list) Object.assign(sc, { file: `${sc.key}.html`, picture: `${sc.key}.jpg`, phonePicture: `${sc.key}@phone.jpg` });
    const url = statusOf(id).url;
    notify({ type: "publishing", project: id, done: 0, total: list.length });
    // Three screens at a time, each from one load of its page (capture: the saved page and both pictures).
    let done = 0;
    const one = async (sc) => {
      const same = list.filter((x) => x.idea === sc.idea);
      const i = same.indexOf(sc);
      const routes = Object.fromEntries(same.map((x) => [x.route, x.file]));
      const others = options.map((o) => ({ name: o.name, file: `${sc.page}~${o.id}.html`, on: o.id === sc.idea }));
      const shots = await capture(url + withIdea(sc.route, sc.idea), `${dir}/${sc.file}`, { routes, bar: screenBar(meta.title || id, n, same, i, others) });
      fs.writeFileSync(path.join(DESIGN_REPO, dir, sc.picture), shots.desktop);
      fs.writeFileSync(path.join(DESIGN_REPO, dir, sc.phonePicture), shots.phone);
      notify({ type: "publishing", project: id, done: ++done, total: list.length });
    };
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (queue.length) await one(queue.shift());
    }));
    const me = await whoAmI();
    const v = { n, name: label, at: new Date().toISOString(), designer: me.name, designerLogin: me.login, base: meta.base, patch: patchHash(patchOf(id)), ideas: ideas?.ideas ?? null, screens: list };
    fs.writeFileSync(path.join(DESIGN_REPO, dir, "version.json"), JSON.stringify(v, null, 2) + "\n");
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
