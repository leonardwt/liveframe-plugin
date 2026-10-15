---
name: variants
description: Try several ideas for a Liveframe design side by side, switched with a variant switcher over the app, then keep the one that wins. Use when the designer asks for variants, a variant switcher, ideas, options, alternatives, "a few versions", "compare", "A/B", "show me another way", or to add, rename, drop or pick between ideas; also when they say which idea wins or that they're done exploring. Only in a Liveframe design's folder (it has CLAUDE.local.md and .liveframe/).
argument-hint: "[what to try, or: pick <idea>]"
---

# Variants: ideas side by side

In a Liveframe design, an **idea** is one version of the design. The designer flips between them with the **switcher** Liveframe draws at the bottom left of the app ("Idea: Before · Dark · Compact"), and the canvas shows a row per idea. **Before** is always there: the app as it is. When one wins, you keep it and take everything else out, so the engineer only ever gets the winner.

What they asked: `$ARGUMENTS`

Check you're in a design's folder (`CLAUDE.local.md` and `.liveframe/journal.md` are here). If not, say this works inside a Liveframe design (from **Design with Claude**) and stop.

## How ideas work

- **The list**: `liveframe.ideas.json` at the top of this folder:

  ```json
  { "showing": "dark", "ideas": [
    { "id": "dark", "name": "Dark", "note": "Dark surfaces, same layout" },
    { "id": "compact", "name": "Compact", "note": "Tighter rows, more on screen" }
  ] }
  ```

  `id`: lowercase letters, numbers, dashes (never `before`). `name`: a word or two the designer would use. `note`: one line saying what's different. `showing`: the idea the switcher starts on (the newest one, usually).

- **Which one shows**: the switcher puts `data-idea="<id>"` on the page's `<html>` (nothing for Before), and fires a `liveframe:idea` event on `window` when it changes. `window.__liveframeIdea` holds the current one. Your code switches on that, nothing else.

- **Styles** (most ideas are only this): scope the idea's rules to the attribute, next to the styles they change, in the app's own way of styling:
  - plain CSS: `:root[data-idea="dark"] .card { … }`
  - CSS Modules: `:global(:root[data-idea="dark"]) .card { … }`
  - Tailwind: an arbitrary variant, `[:root[data-idea=dark]_&]:bg-neutral-900`
  - CSS-in-JS / theme recipes: the selector `':root[data-idea="dark"] &'`

  Still the design system: tokens, not raw values.

- **Code** (different layout, text or components): add **one** small helper, `liveframe.idea.<ext>` at the top of the folder, in the app's framework, that reads the current idea and updates on the event. For React:

  ```tsx
  // liveframe.idea.tsx: Liveframe's idea switch for this design. Removed when one idea wins.
  "use client";
  import { useSyncExternalStore } from "react";
  const read = () => (typeof window === "undefined" ? "before" : (window as any).__liveframeIdea ?? "before");
  const listen = (cb: () => void) => (window.addEventListener("liveframe:idea", cb), () => window.removeEventListener("liveframe:idea", cb));
  export function useIdea(): string { return useSyncExternalStore(listen, read, () => "before"); }
  ```

  Then `useIdea() === "compact" ? <CompactList … /> : <List … />`. Leave Before's code exactly as it was, so Before stays the app as it is. Put an idea's new parts in new files where you can (`ListCompact.tsx`): they're easy to keep or delete later.

## Making ideas

1. If what they want is unclear, ask one short question; otherwise go. Two or three ideas, each clearly different, is plenty.
2. Write `liveframe.ideas.json` and the code. Liveframe saves it all like any change; the switcher appears in the app within a few seconds and the canvas grows a row per idea.
3. Make sure the pages involved are screens on the canvas (add them as `CLAUDE.local.md` says).
4. Tell the designer in plain words: the ideas by name, one line each, and that the switcher at the bottom left of the app flips between them (and Before).
5. Journal: an entry listing the ideas and what each is for.

Adding, renaming or dropping an idea later: change the list and the code together. Dropping one: delete its code and its entry.

## When one wins

The designer says which ("go with Dark", "Compact, but keep Before's header"). Mixing is fine when they say so.

1. Make the winner the code: replace each switch with the winner's branch (its styles become the plain styles, without the `:root[data-idea=…]` part; `useIdea() === …` becomes just the winner's JSX). Delete the other ideas' code and files.
2. Delete `liveframe.ideas.json` and the helper.
3. Check nothing's left: `grep -rn "data-idea\|liveframe:idea\|__liveframeIdea\|liveframe.idea" --exclude-dir=node_modules --exclude-dir=.next .` finds nothing (`.liveframe/` is Liveframe's own and doesn't count).
4. Tell the designer it's one design again, and that **Publish** then **Ready for Development** come next. Ready for Development is greyed out while ideas are left, and its check fails on anything the grep would find.
5. Journal: which idea won and why, in their words.

Never publish, send or open a pull request yourself: those are the designer's buttons.
