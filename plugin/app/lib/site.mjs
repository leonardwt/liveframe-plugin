// The online site: the design repo is the website (Cloudflare serves it as it is, behind the
// company's sign-in), and it is Liveframe itself, read-only: the same pages, the same canvas, without
// the designer's buttons. Liveframe writes:
//
//   index.html                        loads Liveframe's pages in site mode (public/app.js)
//   liveframe/app/                    a copy of Liveframe's pages: app.js, flow.js, app.css, the font
//   liveframe/site.json               what they show: the app, the design system, every published design
//   projects/<id>/index.html          → index.html#/d/<id>          (older links keep working)
//   projects/<id>/v<n>/index.html     → index.html#/d/<id>/v<n>
//   projects/<id>/handoff.html        the handoff note (written by Ready for Development), with sitePage
//   liveframe/site.css                the look of pages like that one
//
// Every file is marked with the Liveframe version that wrote it; a Liveframe older than the site
// leaves it alone (designers on different versions would otherwise keep rewriting it).

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO, ROOT, VERSION, newerVersion } from "./config.mjs";
import { profile } from "./profile.mjs";
import { listDesigns } from "./designs.mjs";
import { designSystemLinks } from "./design-system.mjs";

export const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PAGES = ["app.js", "flow.js", "app.css", "geist.woff2", "geist-OFL.txt"];

/** The version of Liveframe that wrote the site (from its index.html), or null. */
export function siteVersion() {
  try {
    return /<meta name="liveframe-version" content="([^"]+)">/.exec(fs.readFileSync(path.join(DESIGN_REPO, "index.html"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Is the site newer than this Liveframe? Then this one doesn't touch it. */
export const siteIsNewer = () => newerVersion(siteVersion(), VERSION);

/** A plain reading page of the site at `here` (the handoff note), in Liveframe's look. */
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
<meta name="liveframe-version" content="${VERSION}">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(to("liveframe/site.css"))}">
</head>
<body>
<header class="top"><a class="brand" href="${esc(to("index.html"))}">Liveframe</a><span class="sep">/</span><nav class="trail">${trail}</nav><a class="ds" href="${esc(to("design-system/index.html"))}">Design system</a></header>
<main class="main">
${body}
</main>
</body>
</html>
`;
}

/** A page that sends you to Liveframe's page for it. */
const redirect = (here, to) => {
  const up = "../".repeat(here.split("/").length - 1);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="liveframe-version" content="${VERSION}"><title>Liveframe</title><meta http-equiv="refresh" content="0; url=${up}index.html${to}"><script>location.replace(${JSON.stringify(`${up}index.html${to}`)})</script></head><body><a href="${up}index.html${to}">Open in Liveframe</a></body></html>\n`;
};

function shell(appName) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="liveframe-version" content="${VERSION}">
<title>${esc(appName)} designs · Liveframe</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='4' width='18' height='16' rx='4' fill='none' stroke='%23ececef' stroke-width='2'/%3E%3Ccircle cx='12' cy='14' r='2.2' fill='%233d5bff'/%3E%3C/svg%3E">
<link rel="stylesheet" href="liveframe/app/app.css?v=${VERSION}">
<script>window.__liveframeSite = { data: "liveframe/site.json" };</script>
<script type="module" src="liveframe/app/app.js?v=${VERSION}"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`;
}

/** What the online Liveframe shows: published designs only, as of their versions. */
function siteData(designs) {
  const ds = designSystemLinks();
  const published = designs.filter((d) => d.versions.length);
  return {
    app: profile().name,
    version: VERSION,
    designSystem: ds ? { components: `design-system/${ds.components}`, tokens: `design-system/${ds.tokens}` } : null,
    designs: published.map((d) => {
      const last = d.versions.at(-1);
      const pages = [...new Map((last.screens ?? []).map((s) => [s.page, { page: s.page, name: s.name, route: s.route }])).values()];
      return {
        id: d.id,
        title: d.title,
        brief: d.brief,
        designer: d.designer,
        status: d.status,
        ready: d.ready,
        pr: d.pr,
        archivedAt: d.archivedAt,
        versions: d.versions,
        latestVersion: last,
        screens: pages,
        ideas: null,
        unpublished: false,
        savedAt: last.at,
      };
    }),
  };
}

/** Write the online site. Returns the files it wrote (none when the site is newer than this Liveframe). */
export async function writeSite() {
  if (siteIsNewer()) {
    console.log(`[site] the site was made by Liveframe ${siteVersion()}; this is ${VERSION}, so it's left as it is`);
    return [];
  }
  const designs = await listDesigns();
  const files = [
    ["index.html", shell(profile().name)],
    ["liveframe/site.json", JSON.stringify(siteData(designs), null, 2) + "\n"],
    ["liveframe/site.css", fs.readFileSync(new URL("./site.css", import.meta.url), "utf8")],
  ];
  for (const d of designs.filter((x) => x.versions.length)) {
    files.push([`projects/${d.id}/index.html`, redirect(`projects/${d.id}/index.html`, `#/d/${d.id}`)]);
    for (const v of d.versions) files.push([`projects/${d.id}/v${v.n}/index.html`, redirect(`projects/${d.id}/v${v.n}/index.html`, `#/d/${d.id}/v${v.n}`)]);
  }
  const written = [];
  const put = (file, content) => {
    const full = path.join(DESIGN_REPO, file);
    if (fs.existsSync(full) && fs.readFileSync(full).equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) return;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    written.push(file);
  };
  for (const [file, content] of files) put(file, content);
  for (const f of PAGES) put(`liveframe/app/${f}`, fs.readFileSync(path.join(ROOT, "public", f)));
  return written;
}

export { designSystemLinks };
