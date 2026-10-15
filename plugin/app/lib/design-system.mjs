// The design system: plain pages in the design repo, made from the app's own tokens and components.
//
//   design-system/index.html              opens the first component
//   design-system/tokens/colours.html     every colour token, by the groups the app's file uses
//   design-system/tokens/type.html        fonts, sizes, weights, line heights
//   design-system/tokens/spacing.html     spacing steps
//   design-system/components/<name>.html  one per UI component (empty for now: its name and code)
//   design-system/ds.css                  the pages' look
//   design-system/index.json              what's there and which app commit it's from
//
// Read from the app's main line as this Mac's copy has it (git, not the working files), with the
// paths the app profile names. Only pages whose content changed are written: each page carries a
// hash of its content and the app commit it was made from, so an app change that doesn't touch the
// tokens or components leaves the pages alone. A Liveframe older than the one that last wrote them
// leaves them alone too (index.json says which), so designers on different versions don't fight.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DESIGN_REPO, APP_REPO, VERSION, newerVersion } from "./config.mjs";
import { git, gitOk, inOrder, commitPaths, pushSoon } from "./git.mjs";
import { profile } from "./profile.mjs";

const OUT = path.join(DESIGN_REPO, "design-system");

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- reading the app ----------

const show = async (ref, file) => {
  const r = await git(["show", `${ref}:${file}`], { cwd: APP_REPO });
  return r.code === 0 ? r.stdout : null;
};

/** CSS custom properties, in order, with the section comment above each ("Colour: neutrals"). */
export function parseTokens(css, file) {
  const out = [];
  let section = null;
  const re = /\/\*([\s\S]*?)\*\/|(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g;
  for (const m of css.matchAll(re)) {
    if (m[1] != null) {
      const text = m[1].replace(/^[\s*-]+|[\s*-]+$/g, "").trim();
      // A short one-line comment is a section heading; a long one is prose.
      if (text && !text.includes("\n") && text.length <= 60) section = text;
      continue;
    }
    out.push({ name: m[2], value: m[3].trim(), section, file });
  }
  return out;
}

const COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(.*\)|transparent|white|black|currentColor)$/i;
const isColourName = (n) => /colou?r|(^|-)(bg|fg|border|fill|surface|text)(-|$)/i.test(n) && !/font|size|width|radius|shadow/i.test(n);
const kindOf = (t, resolved) => {
  if (/^--(font|text|line-height|leading|letter|tracking|weight)/i.test(t.name) || /font-(size|family|weight)|line-height|letter-spacing/i.test(t.name)) return "type";
  if (/^--(space|spacing|gap|gutter)/i.test(t.name)) return "spacing";
  if ((resolved && COLOUR.test(resolved)) || isColourName(t.name)) return resolved && COLOUR.test(resolved) ? "colour" : null;
  return null;
};

/** What the app's design system is at `ref`: tokens by kind, and the UI components. */
export async function readDesignSystem(ref) {
  const p = profile();
  const tokens = [];
  for (const file of p.designSystem.tokens) {
    const css = await show(ref, file);
    if (css) tokens.push(...parseTokens(css, file));
  }
  const byName = new Map(tokens.map((t) => [t.name, t]));
  const resolve = (value, seen = new Set()) => {
    const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
    if (!m) return value.trim();
    if (seen.has(m[1])) return null;
    seen.add(m[1]);
    const next = byName.get(m[1]);
    return next ? resolve(next.value, seen) : m[2] ? resolve(m[2], seen) : null;
  };
  const kinds = { colour: [], type: [], spacing: [] };
  for (const t of tokens) {
    const resolved = resolve(t.value);
    const kind = kindOf(t, resolved);
    if (!kind) continue;
    const alias = /^var\(\s*(--[A-Za-z0-9_-]+)/.exec(t.value)?.[1] ?? null;
    kinds[kind].push({ ...t, resolved, alias });
  }

  const components = [];
  const CODE = /\.(tsx|jsx|vue|svelte)$/;
  for (const dir of p.designSystem.components) {
    const r = await git(["ls-tree", "--name-only", `${ref}:${dir}`], { cwd: APP_REPO });
    if (r.code !== 0) continue;
    for (const entry of r.stdout.split("\n").filter(Boolean)) {
      if (/\.(test|spec|stories)\./.test(entry) || entry.startsWith("index.") || entry.startsWith("_")) continue;
      const isDir = (await git(["cat-file", "-t", `${ref}:${dir}/${entry}`], { cwd: APP_REPO })).stdout.trim() === "tree";
      if (!isDir && !CODE.test(entry)) continue;
      const name = isDir ? entry : entry.replace(CODE, "");
      if (!/^[A-Za-z]/.test(name) || components.some((c) => c.name === name)) continue;
      components.push({ name, slug: slug(name), file: `${dir}/${entry}` });
    }
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  return { tokens: kinds, components };
}

// ---------- the pages ----------

const TOKEN_PAGES = [
  { kind: "colour", file: "tokens/colours.html", title: "Colours" },
  { kind: "type", file: "tokens/type.html", title: "Type" },
  { kind: "spacing", file: "tokens/spacing.html", title: "Spacing" },
];

function page({ here, title, crumb, body, ds, appName }) {
  const up = here.split("/").length - 1;
  const to = (f) => `${"../".repeat(up)}${f}`;
  const link = (f, label) => `<a href="${esc(to(f))}"${f === here ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(appName)} design system</title>
<link rel="stylesheet" href="${esc(to("ds.css"))}">
<!--liveframe:stamp-->
</head>
<body>
<nav class="side" aria-label="Design system">
  <a class="side__home" href="${esc(to("index.html"))}">${esc(appName)} design system</a>
  <h2>Tokens</h2>
  ${TOKEN_PAGES.map((t) => link(t.file, t.title)).join("\n  ")}
  <h2>Components</h2>
  ${ds.components.map((c) => link(`components/${c.slug}.html`, c.name)).join("\n  ")}
</nav>
<main class="main">
<p class="crumb">${esc(crumb)}</p>
<h1>${esc(title)}</h1>
${body}
<!--liveframe:about-->
</main>
</body>
</html>
`;
}

const swatchText = (hex) => {
  const m = /^#([0-9a-f]{6})/i.exec(hex ?? "");
  if (!m) return "";
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? "dark" : "light";
};

function groups(list) {
  const out = new Map();
  for (const t of list) (out.get(t.section ?? "") ?? out.set(t.section ?? "", []).get(t.section ?? "")).push(t);
  return [...out];
}

function tokenBody(kind, list, src) {
  if (!list.length) return `<p class="empty">The app's token files (${esc(src)}) have no ${kind === "colour" ? "colours" : kind} tokens Liveframe could read.</p>`;
  const section = (heading, rows) => `<section>${heading ? `<h2>${esc(heading)}</h2>` : ""}${rows}</section>`;
  if (kind === "colour") {
    return groups(list).map(([h, ts]) => section(h, `<ul class="colours">${ts.map((t) => `
<li><span class="swatch ${swatchText(t.resolved)}" style="background:${esc(t.resolved)}"></span>
<code class="name">${esc(t.name)}</code><span class="value">${esc(t.resolved)}</span>${t.alias ? `<span class="alias">→ ${esc(t.alias)}</span>` : ""}</li>`).join("")}</ul>`)).join("\n");
  }
  if (kind === "type") {
    return groups(list).map(([h, ts]) => section(h, `<ul class="type">${ts.map((t) => {
      const v = t.resolved ?? t.value;
      let style = "";
      if (/size/i.test(t.name)) style = `font-size:${v}`;
      else if (/family|^--font-(sans|mono|serif|display|body|heading)/i.test(t.name)) style = `font-family:${v}`;
      else if (/weight/i.test(t.name)) style = `font-weight:${v}`;
      else if (/line-height|leading/i.test(t.name)) style = `line-height:${v}`;
      return `
<li><div class="specimen" style="${esc(style)}">The quick brown fox jumps over the lazy dog</div><code class="name">${esc(t.name)}</code><span class="value">${esc(t.value)}</span></li>`;
    }).join("")}</ul>`)).join("\n");
  }
  return groups(list).map(([h, ts]) => section(h, `<ul class="spacing">${ts.map((t) => `
<li><span class="bar" style="width:${esc(t.resolved ?? t.value)}"></span><code class="name">${esc(t.name)}</code><span class="value">${esc(t.value)}</span></li>`).join("")}</ul>`)).join("\n");
}

function componentBody(c, repo, branch) {
  const href = repo ? `${repo.replace(/\.git$/, "")}/${c.file.includes(".") ? "blob" : "tree"}/${branch}/${c.file}` : null;
  return `<p class="empty">Nothing on this page yet.</p>
<p class="where">Code: ${href ? `<a href="${esc(href)}">${esc(c.file)}</a>` : `<code>${esc(c.file)}</code>`}</p>`;
}

/** Every page: { file → html (without the stamp) }. */
function pages(ds, p) {
  const out = {};
  const src = p.designSystem.tokens.join(", ") || "none named";
  for (const t of TOKEN_PAGES) {
    out[t.file] = page({ here: t.file, title: t.title, crumb: "Tokens", body: tokenBody(t.kind, ds.tokens[t.kind], src), ds, appName: p.name });
  }
  for (const c of ds.components) {
    const f = `components/${c.slug}.html`;
    out[f] = page({ here: f, title: c.name, crumb: "Components", body: componentBody(c, p.repo, p.branch), ds, appName: p.name });
  }
  const first = ds.components[0] ? `components/${ds.components[0].slug}.html` : TOKEN_PAGES[0].file;
  out["index.html"] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(p.name)} design system</title><meta http-equiv="refresh" content="0; url=${esc(first)}"></head><body><a href="${esc(first)}">${esc(p.name)} design system</a></body></html>\n`;
  out["ds.css"] = fs.readFileSync(new URL("./design-system.css", import.meta.url), "utf8");
  return out;
}

const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Put the stamp in: the content's hash, and which app commit and when. */
function stamped(html, hash, source) {
  const day = source.at.slice(0, 10);
  return html
    .replace("<!--liveframe:stamp-->", `<meta name="liveframe-content" content="${hash}">`)
    .replace("<!--liveframe:about-->", `<p class="about">From ${esc(source.app)} (${esc(source.branch)}) at <code>${esc(source.sha.slice(0, 8))}</code>, ${esc(day)}. Made by Liveframe; it updates itself when the app's tokens or components change.</p>`);
}

/**
 * Bring the design system up to date with the app at `ref` (default: the app's main line). Writes
 * only the pages whose content changed, removes pages of components that are gone, and commits.
 * Returns { changed: [files], removed: [files], sha }.
 */
export async function updateDesignSystem(ref) {
  const p = profile();
  ref ??= `refs/remotes/origin/${p.branch}`;
  if ((await git(["rev-parse", "--verify", "-q", ref], { cwd: APP_REPO })).code !== 0) ref = p.branch;
  const sha = await gitOk(["rev-parse", ref], { cwd: APP_REPO });
  const at = await gitOk(["log", "-1", "--format=%cI", sha], { cwd: APP_REPO });
  const ds = await readDesignSystem(sha);
  const source = { app: p.name, branch: p.branch, sha, at };
  const want = pages(ds, p);
  const indexFile = path.join(OUT, "index.json");
  const oldIndex = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : null;
  // Made by a newer Liveframe (another designer's): leave it; theirs keeps it up to date.
  if (newerVersion(oldIndex?.liveframe, VERSION)) return { changed: [], removed: [], sha, committed: false, skipped: oldIndex.liveframe };

  return inOrder(async () => {
    const changed = [];
    for (const [file, html] of Object.entries(want)) {
      const full = path.join(OUT, file);
      const isPage = html.includes("<!--liveframe:stamp-->");
      const hash = hashOf(html);
      const old = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
      if (isPage ? old?.includes(`<meta name="liveframe-content" content="${hash}">`) : old === html) continue;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, isPage ? stamped(html, hash, source) : html);
      changed.push(file);
    }
    const removed = [];
    const compDir = path.join(OUT, "components");
    for (const f of fs.existsSync(compDir) ? fs.readdirSync(compDir) : []) {
      if (!want[`components/${f}`]) fs.rmSync(path.join(compDir, f)), removed.push(`components/${f}`);
    }
    const index = { app: p.name, liveframe: VERSION, repo: p.repo, branch: p.branch, sha, at, tokens: { colours: ds.tokens.colour.length, type: ds.tokens.type.length, spacing: ds.tokens.spacing.length }, components: ds.components.map((c) => ({ name: c.name, page: `components/${c.slug}.html`, file: c.file })) };
    const sameShape = oldIndex && JSON.stringify({ ...oldIndex, sha: 0, at: 0 }) === JSON.stringify({ ...index, sha: 0, at: 0 });
    if (!sameShape || changed.length || removed.length) fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
    const what = [...changed, ...removed].filter((f) => f.endsWith(".html")).map((f) => path.basename(f, ".html"));
    const committed = await commitPaths(["design-system"], `Design system: from ${p.name} ${sha.slice(0, 8)}${what.length ? ` (${what.slice(0, 6).join(", ")}${what.length > 6 ? "…" : ""})` : ""}`);
    if (committed) pushSoon();
    return { changed, removed, sha, committed };
  });
}

/** Where the toolbar's links go: the first component, and the first token page. */
export function designSystemLinks() {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"));
    return { components: index.components[0]?.page ?? TOKEN_PAGES[0].file, tokens: TOKEN_PAGES[0].file, sha: index.sha, at: index.at };
  } catch {
    return null;
  }
}
