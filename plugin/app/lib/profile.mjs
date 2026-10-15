// The app profile: everything Liveframe knows about the app, written once at setup
// (`/liveframe:setup`: Claude reads the app and writes it). Kept in the design repo, so every
// designer's Liveframe runs the app the same way.
//
//   liveframe/app.json
//   {
//     "name": "Lumen Books",
//     "repo": "https://github.com/lumen/lumen-books",    the app repo (designers read it)
//     "branch": "main",                                  the app's main line
//     "site": "https://lumen-designs.pages.dev",         where the design repo is online (optional)
//     "install": ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
//     "run": ["node_modules/.bin/next", "dev", "-H", "127.0.0.1", "-p", "{port}"],
//     "env": { "NAME": "value" },                        {port} is filled in
//     "ready": "/",                                      a page that answers once the app runs
//     "signIn": { "cookie": "name=value" },              sent with every request: no sign-in page
//     "frontend": ["app/", "components/", "styles/", "lib/"],   what designs may change
//     "backend": ["server/", "app/api/", "proxy.ts"],           what they never change
//     "pages": [{ "name": "Overview", "route": "/" }],   the app's main pages, to start a design from
//     "designSystem": { "tokens": ["styles/tokens.css"], "components": ["components/ui"] },
//     "notes": "Anything Claude should know when designing in this app."
//   }

import fs from "node:fs";
import path from "node:path";
import { DESIGN_REPO } from "./config.mjs";

export const PROFILE_FILE = path.join(DESIGN_REPO, "liveframe", "app.json");

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

/** The app profile, checked. Throws when there isn't one (the design repo isn't set up yet). */
export function profile() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
  } catch {
    throw new Error(`No app profile at ${PROFILE_FILE}. Run /liveframe:setup first.`);
  }
  const p = {
    name: String(raw.name ?? "The app"),
    repo: String(raw.repo ?? ""),
    branch: String(raw.branch ?? "main"),
    install: list(raw.install),
    run: list(raw.run),
    env: Object.fromEntries(Object.entries(raw.env ?? {}).map(([k, v]) => [k, String(v)])),
    ready: String(raw.ready ?? "/"),
    signIn: { cookie: raw.signIn?.cookie ? String(raw.signIn.cookie) : null },
    frontend: list(raw.frontend),
    backend: list(raw.backend),
    pages: (Array.isArray(raw.pages) ? raw.pages : []).filter((pg) => pg?.route).map((pg) => ({ name: String(pg.name ?? pg.route), route: String(pg.route) })),
    designSystem: { tokens: list(raw.designSystem?.tokens), components: list(raw.designSystem?.components) },
    notes: String(raw.notes ?? ""),
  };
  if (!p.run.length) throw new Error(`The app profile doesn't say how to run the app ("run" in ${PROFILE_FILE}).`);
  return p;
}

export const hasProfile = () => fs.existsSync(PROFILE_FILE);

/** "{port}" and friends filled in. */
export const fill = (s, values) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
