// Small HTTP helpers: who may call, JSON in and out, a tiny router, and content types.

import { PORT } from "./config.mjs";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Liveframe itself (its pages and API) answers on localhost. */
export const APP_HOST = `localhost:${PORT}`;
/**
 * Designs are shown from 127.0.0.1: another origin, so a design page in the frame can't reach
 * Liveframe's page or call its API (the API only answers on localhost).
 */
export const PAGES_HOST = `127.0.0.1:${PORT}`;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Only this Mac's own pages and processes may use Liveframe. Listening on 127.0.0.1 keeps the
 * network out, but not the web pages the designer has open:
 *   - Host must be Liveframe (a site that rebinds its own name to 127.0.0.1 sends its own name).
 *   - The API refuses requests a browser marks as cross-site (Sec-Fetch-Site), GETs included.
 *   - Anything that changes something must come from a local page (Origin) or a process (no Origin).
 */
export function checkCaller(req, url) {
  const host = req.headers.host ?? "";
  if (host !== APP_HOST && host !== PAGES_HOST) throw new HttpError(403, "wrong_host", "Liveframe only answers on localhost.");
  if (url.pathname.startsWith("/api/") && host !== APP_HOST) throw new HttpError(403, "wrong_host", "Liveframe's API only answers on localhost.");
  if (url.pathname.startsWith("/api/") && req.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "cross_site", "Only Liveframe's own pages can use this.");
  }
  const origin = req.headers.origin;
  if (!SAFE_METHODS.has(req.method) && origin !== undefined && origin !== `http://${APP_HOST}`) {
    throw new HttpError(403, "cross_site", "Only Liveframe's own pages can use this.");
  }
}

export function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** The request body as JSON ({} when empty). 415 unless it's sent as application/json. */
export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "too_large", "Request body is too large.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new HttpError(415, "not_json", "Send the body as application/json.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "The body isn't valid JSON.");
  }
}

/** routes: [method, /regex with groups/, handler(params, req, res, url)] */
export function match(routes, method, pathname) {
  for (const [m, re, handler] of routes) {
    if (m !== method && !(m === "GET" && method === "HEAD")) continue;
    const found = re.exec(pathname);
    if (found) return { handler, params: found.slice(1).map((p) => p && decodeURIComponent(p)) };
  }
  return null;
}

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
