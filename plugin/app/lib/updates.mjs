// Is there a newer Liveframe? Checked when Liveframe starts and every few hours, against the
// plugin's GitHub repo (the same check as /liveframe:update). Liveframe's pages show an "Update
// available" pill; clicking it opens a Claude session with /liveframe:update typed in.

import fs from "node:fs";
import path from "node:path";
import { ROOT, VERSION, newerVersion } from "./config.mjs";

const EVERY_MS = 6 * 60 * 60_000;
let state = { current: VERSION, latest: null, notes: [], checkedAt: null };
export const updateState = () => ({ ...state, available: !!state.latest && newerVersion(state.latest, VERSION) });

/** The plugin's GitHub repo (owner/name), from the plugin's own manifest; null when Liveframe isn't run from the plugin. */
function repoSlug() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(path.dirname(ROOT), ".claude-plugin", "plugin.json"), "utf8"));
    return /github\.com\/([^/]+\/[^/.]+)/.exec(m.repository ?? "")?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The changelog's bullet points for versions newer than ours (first lines only, for a tooltip). */
function notesSince(changelog, from) {
  const out = [];
  for (const part of changelog.split(/^## /m).slice(1)) {
    const v = part.split("\n")[0].trim();
    if (!newerVersion(v, from)) continue;
    for (const m of part.matchAll(/^- (.+)$/gm)) out.push(m[1].replace(/\*\*|`/g, "").replace(/: .*/, "").trim());
  }
  return out.slice(0, 6);
}

export async function checkForUpdate() {
  const slug = repoSlug();
  if (!slug) return updateState();
  try {
    const get = async (f) => {
      const r = await fetch(`https://raw.githubusercontent.com/${slug}/main/${f}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(String(r.status));
      return r.text();
    };
    const latest = JSON.parse(await get("plugin/.claude-plugin/plugin.json")).version;
    const notes = newerVersion(latest, VERSION) ? notesSince(await get("CHANGELOG.md").catch(() => ""), VERSION) : [];
    state = { current: VERSION, latest, notes, checkedAt: new Date().toISOString() };
  } catch {
    // Offline: try again at the next check.
  }
  return updateState();
}

export function startCheckingForUpdates() {
  checkForUpdate();
  setInterval(checkForUpdate, EVERY_MS).unref();
}
