// Liveframe: runs on the designer's Mac (http://localhost:<port>). Shows the designs in the design
// repo, runs each design's app from its own folder, saves and shares the work, publishes versions
// for review, and hands designs to engineering. Nothing here is hosted: the design repo is the
// website, served online by whoever hosts it (Cloudflare) and here by Liveframe itself (/site/).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PORT, DESIGN_REPO, APP_REPO, ROOT } from "./lib/config.mjs";
import { HttpError, checkCaller, sendJson, readBody, match, TYPES, APP_HOST, PAGES_HOST } from "./lib/http.mjs";
import { profile, hasProfile } from "./lib/profile.mjs";
import { listDesigns, summary, createDesign, copyDesign, mustBeMine, addScreen, rename, checkId, ensureFolder, ensureRunning, statusOf, touch, stopAllApps, stopWatching, folderOf } from "./lib/designs.mjs";
import { whoAmI } from "./lib/identity.mjs";
import { updateState, startCheckingForUpdates } from "./lib/updates.mjs";
import { openClaude } from "./lib/claude.mjs";
import { stream, closeAll, onEvent } from "./lib/events.mjs";
import { picturesOf, pictureFile, sizeOk, retake, stopPictures } from "./lib/pictures.mjs";
import { quitChrome } from "./lib/chrome.mjs";
import { publish, siteUrl } from "./lib/publish.mjs";
import { readyCheck, markReady } from "./lib/ready.mjs";
import { designSystemLinks } from "./lib/design-system.mjs";
import { keepUp, keepingUp, startKeepingUp } from "./lib/appwatch.mjs";
import { pushState } from "./lib/git.mjs";

const PUBLIC = path.join(ROOT, "public");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const fromButton = (req) => req.headers.origin === `http://${APP_HOST}`;

const routes = [
  ["GET", /^\/api\/health$/, (_p, _req, res) => sendJson(res, 200, { ok: true, version: VERSION, designRepo: DESIGN_REPO, appRepo: APP_REPO })],
  // What the pages need to know: the app, where the site and the design system are, how it's keeping up.
  ["GET", /^\/api\/settings$/, async (_p, _req, res) => {
    const ds = designSystemLinks();
    const me = await whoAmI();
    const site = `http://${PAGES_HOST}/site/`;
    sendJson(res, 200, {
      app: hasProfile() ? profile().name : null,
      online: siteUrl(),
      site,
      designSystem: ds ? { components: site + "design-system/" + ds.components, tokens: site + "design-system/" + ds.tokens, sha: ds.sha, at: ds.at } : null,
      me: { login: me.login, name: me.name },
      update: updateState(),
      keepingUp: keepingUp(),
      push: pushState(),
    });
  }],
  // A newer Liveframe: a Claude session with /liveframe:update typed in (Liveframe's page only).
  ["POST", /^\/api\/update\/claude$/, async (_p, req, res) => {
    if (!fromButton(req)) throw new HttpError(403, "button_only", "Updates are started from Liveframe's own page.");
    sendJson(res, 200, await openClaude(DESIGN_REPO, "/liveframe:update"));
  }],
  ["POST", /^\/api\/keep-up$/, async (_p, _req, res) => sendJson(res, 200, await keepUp())],
  ["GET", /^\/api\/projects$/, async (_p, _req, res) => sendJson(res, 200, await listDesigns())],
  ["POST", /^\/api\/projects$/, async (_p, req, res) => {
    const body = await readBody(req);
    sendJson(res, 201, await createDesign(body.name, body.brief));
  }],
  ["GET", /^\/api\/projects\/([^/]+)$/, async ([id], _req, res) => {
    checkId(id);
    sendJson(res, 200, { ...(await summary(id)), app: statusOf(id) });
  }],
  // Design with Claude: a new session in the design's folder, its first message typed in. Liveframe's page only.
  ["POST", /^\/api\/projects\/([^/]+)\/claude$/, async ([id], req, res) => {
    if (!fromButton(req)) throw new HttpError(403, "button_only", "Claude is opened from Liveframe's own page.");
    checkId(id);
    const d = await summary(id);
    if (d.status === "archived") throw new HttpError(409, "archived", "This design is archived.");
    await mustBeMine(id);
    const body = await readBody(req);
    const pages = profile().pages.map((pg) => pg.name).join(", ");
    const copied = d.copiedFrom ? ` It's my own copy of “${d.copiedFrom.title}” by ${d.copiedFrom.designer || "someone"}, starting where theirs is (their journal: projects/${d.copiedFrom.id}/journal.md in the design repo).` : "";
    const first = body.start
      ? `Let's start the design “${d.title}”.${copied} ${d.brief || `Which page do you want to change? (${pages})`}`
      : `Let's carry on with the design “${d.title}”.`;
    const folder = await ensureFolder(id);
    ensureRunning(id);
    sendJson(res, 200, await openClaude(folder, first));
  }],
  // The design's app. GET: how it is. POST: open the design (its folder, brought up to date) and start it.
  ["GET", /^\/api\/projects\/([^/]+)\/app$/, ([id], _req, res) => {
    checkId(id);
    touch(id);
    sendJson(res, 200, statusOf(id));
  }],
  ["POST", /^\/api\/projects\/([^/]+)\/app$/, async ([id], _req, res) => {
    checkId(id);
    await mustBeMine(id);
    ensureFolder(id).catch((e) => console.error(`[folder ${id}] ${e.message}`));
    sendJson(res, 200, ensureRunning(id));
  }],
  ["GET", /^\/api\/projects\/([^/]+)\/pictures$/, ([id], _req, res, url) => {
    checkId(id);
    const w = Number(url.searchParams.get("w"));
    const h = Number(url.searchParams.get("h"));
    if (!sizeOk(w, h)) throw new HttpError(400, "bad_size", "Pictures are 200–2560 pixels each way.");
    sendJson(res, 200, { pictures: picturesOf(id, w, h) });
  }],
  // A screen on the canvas: an app page by its address (Claude adds them as the designer names pages).
  ["POST", /^\/api\/projects\/([^/]+)\/screens$/, async ([id], req, res) => {
    checkId(id);
    await mustBeMine(id);
    const body = await readBody(req);
    sendJson(res, 201, await addScreen(id, body.name, body.route));
  }],
  ["POST", /^\/api\/projects\/([^/]+)\/rename$/, async ([id], req, res) => {
    checkId(id);
    await mustBeMine(id);
    const body = await readBody(req);
    sendJson(res, 200, await rename(id, body.what, body.name));
  }],
  ["POST", /^\/api\/projects\/([^/]+)\/publish$/, async ([id], req, res) => {
    if (!fromButton(req)) throw new HttpError(403, "button_only", "Publish is the designer's button in Liveframe.");
    checkId(id);
    await mustBeMine(id);
    const body = await readBody(req);
    sendJson(res, 200, await publish(id, body.name));
  }],
  // My own copy of someone else's design (their design stays theirs). Liveframe's page only.
  ["POST", /^\/api\/projects\/([^/]+)\/copy$/, async ([id], req, res) => {
    if (!fromButton(req)) throw new HttpError(403, "button_only", "Copies are made from Liveframe's own page.");
    const body = await readBody(req);
    sendJson(res, 201, await copyDesign(id, body.name));
  }],
  ["GET", /^\/api\/projects\/([^/]+)\/ready$/, async ([id], _req, res) => sendJson(res, 200, await readyCheck(id))],
  ["POST", /^\/api\/projects\/([^/]+)\/ready$/, async ([id], req, res) => {
    if (!fromButton(req)) throw new HttpError(403, "button_only", "Ready for Development is the designer's button in Liveframe.");
    checkId(id);
    await mustBeMine(id);
    sendJson(res, 200, await markReady(id));
  }],
  ["GET", /^\/api\/events$/, (_p, req, res) => stream(req, res)],
  // A picture of a design's screen (served with the site, on 127.0.0.1).
  ["GET", /^\/view\/pictures\/([^/]+)\/([^/@]+)@(\d+)x(\d+)\.jpg$/, ([id, page, w, h], req, res) => {
    checkId(id);
    const file = /^[\w.~-]+$/.test(page) && sizeOk(Number(w), Number(h)) ? pictureFile(id, page, Number(w), Number(h)) : null;
    if (!file) throw new HttpError(404, "not_found", "There's no picture of that screen yet.");
    const body = fs.readFileSync(file);
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": body.length, "cache-control": "public, max-age=31536000, immutable" });
    res.end(req.method === "HEAD" ? undefined : body);
  }],
  // The design repo as the website: published versions, handoffs, the design system.
  ["GET", /^\/site\/(.*)$/, ([rel], req, res) => {
    const clean = path.posix.normalize("/" + (rel || "index.html")).slice(1) || "index.html";
    if (clean.split("/").some((part) => part.startsWith(".")) || clean.startsWith("..")) throw new HttpError(404, "not_found", "There's no such page.");
    let file = path.join(DESIGN_REPO, clean);
    if (!file.startsWith(DESIGN_REPO + path.sep) && file !== DESIGN_REPO) throw new HttpError(404, "not_found", "There's no such page.");
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, "not_found", "There's no such page.");
    const body = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "content-type": TYPES[ext] ?? (ext === ".patch" || ext === ".md" ? "text/plain; charset=utf-8" : "application/octet-stream"), "content-length": body.length, "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  }],
];

function sendStatic(req, res, rel) {
  const file = path.resolve(PUBLIC, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": stat.size, "cache-control": "no-cache" });
  if (req.method === "HEAD") return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    checkCaller(req, url);
    // The site and pictures only from 127.0.0.1; Liveframe itself only from localhost (see PAGES_HOST).
    const isSite = url.pathname.startsWith("/site/") || url.pathname.startsWith("/view/");
    const want = isSite ? PAGES_HOST : APP_HOST;
    if (req.headers.host !== want && !url.pathname.startsWith("/api/")) {
      res.writeHead(302, { location: `http://${want}${url.pathname}${url.search}` });
      return res.end();
    }
    const found = match(routes, req.method, url.pathname);
    if (found) return await found.handler(found.params, req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method", "Not allowed.");
    if (url.pathname.startsWith("/assets/") && sendStatic(req, res, url.pathname.slice("/assets/".length))) return;
    if (url.pathname === "/" || /^\/d\/[^/]+$/.test(url.pathname)) {
      if (sendStatic(req, res, "index.html")) return;
    }
    throw new HttpError(404, "not_found", "There's nothing here.");
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message });
    console.error(err);
    sendJson(res, 500, { error: "internal", message: err.message });
  }
});

// A save retakes the design's pictures.
onEvent((e) => e.type === "saved" && retake(e.project));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Liveframe on http://localhost:${PORT} · ${hasProfile() ? profile().name : "no app profile yet"} · designs from ${DESIGN_REPO} · app from ${APP_REPO}`);
  startKeepingUp();
  startCheckingForUpdates();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    closeAll();
    stopPictures();
    stopWatching();
    stopAllApps();
    quitChrome();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

export { folderOf };
