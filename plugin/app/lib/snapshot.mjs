// Publish's saved pages: a screen of the running app saved as one plain page. No scripts, nothing
// runs: the page as it rendered, only the CSS it uses (so hover and focus still work), canvases as
// pictures. Fonts and images go to assets/<content hash>.<ext> at the top of the design repo, stored
// once for every screen and version. Links to other screens of the same version go to their saved
// page; other links in the app go nowhere (there's no app online).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DESIGN_REPO } from "./config.mjs";
import { openPage, evaluate } from "./chrome.mjs";

const EXT = { "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf", "application/font-woff2": "woff2", "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/x-icon": "ico" };

// Runs in the page: the rendered page as one HTML string. `routes`: { "/orders": "orders.html" }.
const IN_PAGE = (routes) => `(async () => {
  const routes = ${JSON.stringify(routes)};
  const matches = (selector) => {
    const bare = selector.replace(/::?[a-zA-Z-]+(\\([^)]*\\))?/g, (m) => (/^:(not|is|where|has)\\(/.test(m) ? m : "")).trim();
    if (!bare || bare === "*") return true;
    try { return !!document.querySelector(bare); } catch { return true; }
  };
  const keep = (rule) => {
    if (rule instanceof CSSStyleRule) return rule.selectorText.split(",").some((sel) => matches(sel)) ? rule.cssText : "";
    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const inner = [...rule.cssRules].map(keep).join("");
      return inner ? "@" + (rule instanceof CSSMediaRule ? "media " : "supports ") + rule.conditionText + "{" + inner + "}" : "";
    }
    return rule.cssText;
  };
  let css = "";
  const external = [];
  for (const sheet of document.styleSheets) {
    try {
      const base = sheet.href ?? location.href;
      for (const rule of sheet.cssRules) css += keep(rule).replace(/url\\((['"]?)([^'")]+)\\1\\)/g, (m, q, u) => (u.startsWith("data:") ? m : 'url("' + new URL(u, base).href + '")')) + "\\n";
    } catch { if (sheet.href) external.push(sheet.href); }
  }
  const canvases = [...document.querySelectorAll("canvas")].map((c) => { try { return c.toDataURL("image/png"); } catch { return null; } });
  document.querySelectorAll("input, textarea").forEach((i) => i.setAttribute("value", i.value));
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("canvas").forEach((c, i) => {
    if (!canvases[i]) return;
    const img = document.createElement("img");
    img.src = canvases[i];
    img.setAttribute("style", (c.getAttribute("style") ?? "") + ";width:" + (c.style.width || c.width + "px") + ";height:" + (c.style.height || c.height + "px") + ";display:block");
    if (c.className) img.className = c.className;
    c.replaceWith(img);
  });
  clone.querySelectorAll("script, noscript, link[rel=stylesheet], link[rel=preload], link[rel=modulepreload], link[rel=prefetch], link[rel=manifest], style, nextjs-portal, [data-nextjs-toast], template").forEach((n) => n.remove());
  for (const img of clone.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!src.startsWith("data:")) img.setAttribute("src", new URL(src, location.href).href);
    img.removeAttribute("srcset");
    img.removeAttribute("loading");
  }
  for (const a of clone.querySelectorAll("a[href]")) {
    const u = new URL(a.getAttribute("href"), location.href);
    if (u.origin !== location.origin) continue;
    const to = routes[u.pathname];
    if (to) a.setAttribute("href", to);
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
  }
  for (const f of clone.querySelectorAll("form")) f.removeAttribute("action");
  const head = clone.querySelector("head");
  for (const href of external) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; head.append(l); }
  const style = document.createElement("style");
  style.textContent = css;
  head.append(style);
  return "<!doctype html>\\n" + clone.outerHTML;
})()`;

/**
 * Save the page at `url` (a running design) as a plain page at `file` (a path in the design repo).
 * routes: other screens of this version, { route: "file.html" }. bar: HTML put at the end of <body>.
 * Returns the page's size in bytes.
 */
export async function snapshot(url, file, { width = 1440, height = 900, routes = {}, bar = "" } = {}) {
  const { page, close } = await openPage(url, { width, height });
  let html;
  try {
    html = await evaluate(page, IN_PAGE(routes));
  } finally {
    await close();
  }
  const origin = new URL(url).origin;
  const assetsDir = path.join(DESIGN_REPO, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const toAssets = path.posix.relative(path.posix.dirname(file), "assets");
  const store = (buf, type) => {
    const name = `${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16)}.${EXT[type] ?? "bin"}`;
    const f = path.join(assetsDir, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    return `${toAssets}/${name}`;
  };
  // Big inline pictures (canvases) → files.
  let out = html.replace(/data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)/g, (m, type, b64) => (b64.length > 4096 ? store(Buffer.from(b64, "base64"), type) : m));
  // Same-origin fonts and images → files.
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const remote = [...new Set([...out.matchAll(new RegExp(`${escaped}/[^"')\\s]+`, "g"))].map((m) => m[0].replace(/&amp;/g, "&")))];
  for (const u of remote) {
    try {
      const res = await fetch(u.replace("//localhost:", "//127.0.0.1:"));
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!/^(font|image)\/|^application\/font/.test(type)) continue;
      const to = store(Buffer.from(await res.arrayBuffer()), type);
      out = out.split(u).join(to).split(u.replace(/&/g, "&amp;")).join(to);
    } catch {}
  }
  // Anything else still pointing at the running app goes nowhere rather than to a dead address.
  out = out.split(origin).join("");
  if (bar) out = out.replace(/<\/body>/i, `${bar}</body>`);
  const full = path.join(DESIGN_REPO, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, out);
  return Buffer.byteLength(out);
}
