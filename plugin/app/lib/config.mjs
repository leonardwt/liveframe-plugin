// Where things are on this Mac. Set with environment variables (bin/open.mjs sets them for you).

import os from "node:os";
import path from "node:path";

const home = os.homedir();
const GB = 2 ** 30;

export const PORT = Number(process.env.LIVEFRAME_PORT ?? 4300);

/** This Mac's copy of the design repo: projects/, design-system/, liveframe/ (the app profile). */
export const DESIGN_REPO = path.resolve(process.env.LIVEFRAME_DESIGN_REPO ?? path.join(home, "design-repo"));

/** This Mac's copy of the app repo. Liveframe only reads it (and keeps it up to date with GitHub). */
export const APP_REPO = path.resolve(process.env.LIVEFRAME_APP_REPO ?? path.join(home, "app"));

export const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));

/** Design folders: <DESIGNS_DIR>/<id>, one per design, each a git worktree of the app copy. */
export const DESIGNS_DIR = path.resolve(process.env.LIVEFRAME_DESIGNS_DIR ?? path.join(home, "Designs", path.basename(DESIGN_REPO)));

/** Liveframe's own state on this Mac: ports, logs, pictures, Chrome's profile. */
export const STATE_DIR = path.resolve(process.env.LIVEFRAME_STATE_DIR ?? path.join(home, ".liveframe", path.basename(DESIGN_REPO)));

/** Ports for designs' apps: two per design (the app, and the proxy the canvas frames), fixed once given. */
export const APP_PORTS = { first: Number(process.env.LIVEFRAME_APP_PORTS_FROM ?? 3500), last: Number(process.env.LIVEFRAME_APP_PORTS_TO ?? 3799) };

/** Designs' apps running at once: two on a Mac with 16 GB or more, else one. The one used longest ago stops first. */
export const MAX_RUNNING = Number(process.env.LIVEFRAME_MAX_RUNNING ?? (os.totalmem() >= 16 * GB ? 2 : 1));

/** A design's app stops after this long with nobody looking at it. */
export const IDLE_MS = Number(process.env.LIVEFRAME_IDLE_MIN ?? 30) * 60_000;

/** How often Liveframe looks for changes to the app on GitHub (and merged handoffs). */
export const CHECK_MS = Number(process.env.LIVEFRAME_CHECK_MIN ?? 5) * 60_000;

/** Chrome on this Mac: takes pictures of screens and saves published pages. */
export const CHROME = process.env.LIVEFRAME_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Tests: don't push to GitHub. */
export const NO_PUSH = process.env.LIVEFRAME_NO_PUSH === "1";
