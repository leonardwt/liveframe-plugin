// Pictures of a design's screens, so its canvas opens at once without running the app per screen.
//
//   <STATE_DIR>/pictures/<id>/<page>@<w>x<h>.jpg
//
// Taken with Chrome (lib/chrome.mjs) from the design's running app, one at a time. Retaken when the
// design is saved, and once per size each time Liveframe starts. Every new picture is announced to
// open pages: { type: "pictures", project }.

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./config.mjs";
import { screensOf, statusOf, touch } from "./designs.mjs";
import { openPage } from "./chrome.mjs";
import { notify } from "./events.mjs";

const DIR = path.join(STATE_DIR, "pictures");

const fileOf = (id, page, w, h) => path.join(DIR, id, `${page}@${w}x${h}.jpg`);
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
  for (const { page, route } of screensOf(id)) {
    let stat = null;
    try {
      stat = fs.statSync(fileOf(id, page, w, h));
    } catch {}
    if (stat) out[page] = Math.round(stat.mtimeMs);
    if (!stat || first) want(id, page, route, w, h);
  }
  run();
  return out;
}

export function pictureFile(id, page, w, h) {
  const file = fileOf(id, page, w, h);
  return fs.existsSync(file) ? file : null;
}

function want(id, page, route, w, h) {
  queue.set(`${id}|${page}|${w}|${h}`, { id, page, route, w, h });
}

/** The design was saved: retake every picture its canvas uses. */
export function retake(id) {
  for (const size of sizes.get(id) ?? []) {
    const [w, h] = size.split("x").map(Number);
    for (const { page, route } of screensOf(id)) want(id, page, route, w, h);
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
