// Live updates: watches the design repo and tells open pages which design changed, so a save
// shows up while Claude is still working, and a new version shows in the list.

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO } from "./config.mjs";

const clients = new Set();
const pending = new Map();
let watcher = null;

function send(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

// Liveframe's own parts can listen too (a save retakes the design's pictures).
const listeners = new Set();
export const onEvent = (fn) => listeners.add(fn);

/** Tell open pages (and listeners) something that isn't a file in the design repo, e.g. a save or new pictures. */
export const notify = (event) => {
  send(event);
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {}
  }
};

function later(key, event) {
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => (pending.delete(key), send(event)), 250));
}

function onChange(rel) {
  if (!rel) return;
  const parts = rel.split(path.sep);
  if (parts[0] === ".git") {
    // Only what changes versions and saves: tags, branches, HEAD. Not git's own bookkeeping.
    if (parts[1] === "refs" || parts[1] === "packed-refs" || parts[1] === "HEAD") later("*", { type: "changed", project: null });
    return;
  }
  if (parts[0] === "projects" && parts[1]) later(parts[1], { type: "changed", project: parts[1] });
  else if (parts[0] === "shared") later("*", { type: "changed", project: null });
}

function watch() {
  if (watcher) return;
  try {
    watcher = fs.watch(DESIGN_REPO, { recursive: true }, (_type, rel) => onChange(rel ? String(rel) : ""));
    watcher.on("error", () => {
      watcher = null;
    });
  } catch {
    watcher = null; // no design repo yet; the next page that connects tries again
  }
}

export function stream(req, res) {
  watch();
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write(": hello\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function closeAll() {
  for (const res of clients) res.end();
  clients.clear();
  watcher?.close();
}
