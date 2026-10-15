// Pictures of a design's screens, so its canvas opens at once without running the app per screen.
//
//   <STATE_DIR>/pictures/<id>/<page>@<w>x<h>.jpg          a screen
//   <STATE_DIR>/pictures/<id>/<page>~<idea>@<w>x<h>.jpg   a screen on one idea (designs with ideas)
//
// Taken with Chrome (lib/chrome.mjs) from the design's running app, one at a time. Retaken when the
// design is saved, and once per size each time Liveframe starts. Every new picture is announced to
// open pages: { type: "pictures", project }.

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./config.mjs";
import { screensOf, statusOf, touch, metaOf } from "./designs.mjs";
import { optionsOf } from "./ideas.mjs";
import { openPage } from "./chrome.mjs";
import { notify } from "./events.mjs";

const DIR = path.join(STATE_DIR, "pictures");

const fileOf = (id, key, w, h) => path.join(DIR, id, `${key}@${w}x${h}.jpg`);

/** What the canvas shows: each screen, or each screen on each idea. [{ key, route }] */
export function shotsOf(id) {
  const options = optionsOf(metaOf(id).ideas ?? null);
  return screensOf(id).flatMap(({ page, route }) =>
    options.length ? options.map((o) => ({ key: `${page}~${o.id}`, route: withIdea(route, o.id) })) : [{ key: page, route }],
  );
}

/** A page's address with the idea pinned (the switcher reads ?idea=). */
export const withIdea = (route, idea) => (idea ? `${route}${route.includes("?") ? "&" : "?"}idea=${encodeURIComponent(idea)}` : route);
export const sizeOk = (w, h) => Number.isInteger(w) && Number.isInteger(h) && w >= 200 && w <= 2560 && h >= 200 && h <= 2560;

const queue = new Map(); // "<id>|<page>|<w>|<h>" → job
const sizes = new Map(); // id → Set("wxh") its canvas has asked for
const checked = new Set(); // "<id>|wxh" retaken once since Liveframe started
let busy = false;

/** The design's pictures at a size: { <page>: <stamp> }. Missing ones are taken once its app runs. */
export function picturesOf(id, w, h) {
  (sizes.get(id) ?? sizes.set(id, new Set()).get(id)).add(`${w}x${h}`);
  const first = !checked.has(`${id}|${w}x${h}`);
  checked.add(`${id}|${w}x${h}`);
  const out = {};
  for (const { key, route } of shotsOf(id)) {
    let stat = null;
    try {
      stat = fs.statSync(fileOf(id, key, w, h));
    } catch {}
    if (stat) out[key] = Math.round(stat.mtimeMs);
    if (!stat || first) want(id, key, route, w, h);
  }
  run();
  return out;
}

export function pictureFile(id, key, w, h) {
  const file = fileOf(id, key, w, h);
  return fs.existsSync(file) ? file : null;
}

function want(id, page, route, w, h) {
  queue.set(`${id}|${page}|${w}|${h}`, { id, page, route, w, h });
}

/** The design was saved: retake every picture its canvas uses. */
export function retake(id) {
  for (const size of sizes.get(id) ?? []) {
    const [w, h] = size.split("x").map(Number);
    for (const { key, route } of shotsOf(id)) want(id, key, route, w, h);
  }
  run();
}

/** A picture of one page of a running design (JPEG bytes). Publish uses it for its covers too. */
export async function takePicture(url, w, h) {
  const { page, close } = await openPage(url, { width: w, height: h });
  try {
    const { data } = await page("Page.captureScreenshot", { format: "jpeg", quality: 82, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    return Buffer.from(data, "base64");
  } finally {
    await close();
  }
}

async function run() {
  if (busy) return;
  busy = true;
  try {
    while (queue.size) {
      // A design whose app isn't running yet waits (its canvas starts it); the others go first.
      const job = [...queue.values()].find((j) => statusOf(j.id).state === "ready");
      if (!job) break;
      queue.delete(`${job.id}|${job.page}|${job.w}|${job.h}`);
      try {
        touch(job.id);
        const jpg = await takePicture(statusOf(job.id).url + job.route, job.w, job.h);
        fs.mkdirSync(path.join(DIR, job.id), { recursive: true });
        const file = fileOf(job.id, job.page, job.w, job.h);
        fs.writeFileSync(file + ".tmp", jpg);
        fs.renameSync(file + ".tmp", file);
        notify({ type: "pictures", project: job.id });
      } catch (e) {
        console.error(`[pictures ${job.id}] ${job.page}: ${e.message}`);
      }
    }
  } finally {
    busy = false;
    if ([...queue.values()].some((j) => ["setting-up", "installing", "starting"].includes(statusOf(j.id).state))) setTimeout(run, 3000).unref();
  }
}

export function stopPictures() {
  queue.clear();
}
