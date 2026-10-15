// Ideas: several versions of a design side by side, switched with a switcher over the app.
//
// A design with ideas has, at the top of its folder (so it's part of the design's change while it
// explores, and gone once one idea wins):
//
//   liveframe.ideas.json   { "showing": "<id>", "ideas": [{ "id": "dark", "name": "Dark", "note": "…" }] }
//
// "before" is always there too: the app as it is. Which idea shows is the `data-idea` attribute on
// the page's <html> (none for "before"), set by the switcher Liveframe's proxy adds to every page
// (switcher.js). The design's code switches on it: CSS under `:root[data-idea="dark"]`, or a small
// helper the design adds for code (the variants skill says how). Ready for Development needs the
// file and every switch gone: one idea left.

import fs from "node:fs";
import path from "node:path";

export const IDEAS_FILE = "liveframe.ideas.json";
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The ideas in a folder: { showing, ideas: [{ id, name, note }] }, or null when there are none. */
export function readIdeas(folder) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(folder, IDEAS_FILE), "utf8"));
  } catch {
    return null;
  }
  const ideas = (Array.isArray(raw?.ideas) ? raw.ideas : [])
    .filter((i) => i && ID.test(String(i.id ?? "")) && i.id !== "before")
    .map((i) => ({ id: String(i.id), name: String(i.name ?? i.id).slice(0, 60), note: i.note ? String(i.note).slice(0, 200) : null }));
  if (!ideas.length) return null;
  const showing = ideas.some((i) => i.id === raw.showing) || raw.showing === "before" ? raw.showing : ideas[0].id;
  return { showing, ideas };
}

/** Every option, "before" first: [{ id, name }]. */
export const optionsOf = (ideas) => (ideas ? [{ id: "before", name: "Before", note: "The app as it is" }, ...ideas.ideas] : []);
