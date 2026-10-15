// The online pages: the design repo is the website (Cloudflare serves it as it is, behind the
// company's sign-in). Liveframe writes the pages that tie it together:
//
//   index.html                       every published design, and the design system
//   projects/<id>/index.html         a design: its versions, newest first, and where it stands
//   projects/<id>/v<n>/index.html    a version: its screens (written by Publish)
//   liveframe/site.css               their look
//
// All links are relative, so the same files work on this Mac (Liveframe serves them) and online.

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO } from "./config.mjs";
import { profile } from "./profile.mjs";
import { listDesigns } from "./designs.mjs";
import { designSystemLinks } from "./design-system.mjs";

export const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** A page of the site at `here` (a path in the design repo). */
export function sitePage(here, { title, crumbs = [], body }) {
  const up = here.split("/").length - 1;
  const to = (f) => `${"../".repeat(up)}${f}`;
  const trail = [["index.html", `${profile().name} designs`], ...crumbs]
    .map(([href, label], i, all) => (i === all.length - 1 && !href ? `<span>${esc(label)}</span>` : `<a href="${esc(to(href))}">${esc(label)}</a>`))
    .join('<span class="sep">/</span>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(to("liveframe/site.css"))}">
</head>
<body>
<header class="top"><nav class="trail">${trail}</nav><a class="ds" href="${esc(to("design-system/index.html"))}">Design system</a></header>
<main class="main">
${body}
</main>
</body>
</html>
`;
}

function statusChip(d) {
  if (d.status === "archived") return `<span class="chip chip--done">Built${d.pr ? "" : ""}</span>`;
  if (d.status === "ready") return `<span class="chip chip--ready">Ready for Development</span>`;
  return "";
}

/** projects/<id>/index.html */
function designPage(d) {
  const here = `projects/${d.id}/index.html`;
  const versions = [...d.versions].reverse();
  const ready = d.ready ? `<section class="note"><h2>Ready for Development · v${d.ready.version}</h2>
<p>Handed to engineering ${esc(day(d.ready.at))}. <a href="v${d.ready.version}/index.html">See v${d.ready.version}</a> · <a href="handoff.html">Handoff note</a>${d.pr ? ` · <a href="${esc(d.pr)}">Pull request</a>` : ""}</p></section>` : "";
  const body = `<h1>${esc(d.title)} ${statusChip(d)}</h1>
${d.brief ? `<p class="lead">${esc(d.brief)}</p>` : ""}
${ready}
<h2 class="h2">Versions</h2>
${versions.length ? `<ul class="list">${versions.map((v) => `<li><a href="v${v.n}/index.html"><strong>v${v.n} · ${esc(v.name)}</strong><span>${esc(day(v.at))} · ${v.screens?.length ?? 0} screen${v.screens?.length === 1 ? "" : "s"}</span></a></li>`).join("")}</ul>` : `<p class="muted">Nothing published yet.</p>`}`;
  return [here, sitePage(here, { title: d.title, crumbs: [[null, d.title]], body })];
}

/** index.html */
function homePage(designs) {
  const shown = designs.filter((d) => d.versions.length);
  const open = shown.filter((d) => d.status !== "archived");
  const done = shown.filter((d) => d.status === "archived");
  const card = (d) => {
    const v = d.latestVersion;
    const cover = v?.screens?.[0]?.picture ? `<img src="projects/${esc(d.id)}/v${v.n}/${esc(v.screens[0].picture)}" alt="">` : "";
    return `<li><a class="card" href="projects/${esc(d.id)}/index.html"><div class="card__cover">${cover}</div><div class="card__body"><strong>${esc(d.title)}</strong>${statusChip(d)}<span>v${v.n} · ${esc(v.name)} · ${esc(day(v.at))}</span></div></a></li>`;
  };
  const body = `<h1>${esc(profile().name)} designs</h1>
${open.length ? `<ul class="cards">${open.map(card).join("")}</ul>` : `<p class="muted">Nothing published yet.</p>`}
${done.length ? `<h2 class="h2">Built</h2><ul class="cards">${done.map(card).join("")}</ul>` : ""}`;
  return ["index.html", sitePage("index.html", { title: `${profile().name} designs`, body })];
}

/** Write the site's own pages (home, and each design's page). Returns the files it wrote. */
export async function writeSite() {
  const designs = await listDesigns();
  const files = [homePage(designs), ...designs.filter((d) => d.versions.length).map(designPage)];
  fs.mkdirSync(path.join(DESIGN_REPO, "liveframe"), { recursive: true });
  files.push(["liveframe/site.css", fs.readFileSync(new URL("./site.css", import.meta.url), "utf8")]);
  const written = [];
  for (const [file, html] of files) {
    const full = path.join(DESIGN_REPO, file);
    if (fs.existsSync(full) && fs.readFileSync(full, "utf8") === html) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, html);
    written.push(file);
  }
  return written;
}

export { designSystemLinks };
