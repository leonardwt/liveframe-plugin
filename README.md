# Liveframe

**Designers change an app's real code with Claude, on their own Mac.** No mockups to redraw: the
design *is* the app, changed. Liveframe keeps each design in a separate design repo, publishes
versions as plain pages your team reviews online, keeps a design system page up to date from the
app's code, and hands finished designs to engineers as a pull request.

It's a free plugin for [Claude Code](https://claude.com/claude-code). Nothing is hosted for you:
Liveframe runs on each designer's Mac, and the design repo doubles as the review website.

## How it works

```
the app's repo      ← designers only read it; engineers merge designs into it
      │
      ▼
your Mac: Liveframe ─ runs the app from a design's own folder, Claude changes the code,
      │               saves and shares every change
      ▼
the design repo     ← designs (each one a change to the app, a journal, published versions),
                      the design system, and the website reviewers see
```

1. **Design.** In Liveframe, **New design** opens Claude in the design's own copy of the app. Say
   which page and what to change; the canvas shows the real page as Claude changes it. Every change
   is saved and shared by itself.

   **Ideas side by side:** ask for variants ("try a dark version and a compact one") and Claude builds
   them behind a switcher Liveframe draws over the app; the canvas shows a row per idea. Tell Claude
   which one wins and it keeps that one and takes the rest out (`/liveframe:variants`).
   **One designer per design:** someone else's design opens read-only; **Make my own copy** starts
   yours from where theirs is.
2. **Publish.** Saves the design's screens as plain pages for review, online a minute later. The
   online site *is* Liveframe, read-only: the same designs page and canvas, without the designer's
   buttons, showing published versions.
3. **Ready for Development.** Checks the design (published as it is, one idea left, still fits the
   app, frontend only, design-system notes), then Claude writes a handoff note from the design's journal.
4. **Take it.** The engineer runs `/liveframe:take`: a branch and a pull request with the change and
   the note. When it's merged, Liveframe archives the design.

The **design system** page shows the app's tokens (colours, type, spacing) and a page per UI
component, made from the app's code. When the code changes, only the pages it touches change.

## Install

In Claude Code:

```
/plugin marketplace add leonardwt/liveframe-plugin
/plugin install liveframe@liveframe
```

Liveframe needs a Mac with Node 22 or newer, git, Google Chrome and GitHub's `gh` signed in. You don't
have to set those up first: the first `/liveframe:open` checks the Mac, lists what's missing, and
installs it all with one yes (the parts that need your Mac password or a GitHub sign-in come as one
command to paste in Terminal).

To update later, run `/liveframe:update`: it says what's new and updates when you say yes. What's
new in each version: [CHANGELOG.md](CHANGELOG.md).

## Set up an app (once)

1. **Create an empty repo** on GitHub for the designs, e.g. `<org>/<app>-design`.
2. **Give access**: designers can write to the design repo and read the app's repo.
3. **In a copy of the app's repo**, run:

   ```
   /liveframe:setup https://github.com/<org>/<app>-design
   ```

   Claude reads the app, writes its profile (how to run it, its pages, tokens, components, sign-in,
   what's frontend and backend), proves it by running the app, then fills the design repo and
   pushes it. It tells you what fits and what doesn't.

4. **Optional: put it online for reviewers.** Host the design repo as a static website behind your
   company's sign-in. With Cloudflare (free for up to 50 people): Pages from the design repo
   (framework none, build command `exit 0`, output directory `/`), locked with Zero Trust Access.
   `/liveframe:setup` walks you through it.

**What fits:** a web app whose frontend runs on a Mac with test data: its own dev backend, mocks or
fixtures, and test accounts. Apps that only run against a real backend don't fit yet; setup says so.

## Design

```
/liveframe:open https://github.com/<org>/<app>-design
```

The first time, it checks your Mac, gets the copies it needs into `~/Liveframe/`, starts Liveframe
and opens it in your browser. After that, `/liveframe:open` is enough. `/liveframe:open stop` stops it.

## Take a design (engineers)

In the app's repo:

```
/liveframe:take <design> https://github.com/<org>/<app>-design
```

The design's handoff page has the exact command.

## What's where

| | |
|---|---|
| `plugin/skills/` | `/liveframe:setup`, `/liveframe:open`, `/liveframe:variants`, `/liveframe:take`, `/liveframe:update` |
| `plugin/app/` | Liveframe itself: `server.mjs` and `lib/` (Node, no packages), `public/` (its pages), `kit/` (Claude's rules in each design's folder), `bin/` (the scripts the skills run) |
| `plugin/app/examples/app.example.json` | An app profile, for a made-up app |

In a **design repo**: `liveframe/app.json` (the app profile), `projects/<design>/` (`changes.patch`:
the design's change to the app from the commit in `project.json`; `journal.md`; `v1/`, `v2/`…:
published versions; `handoff.md`), `design-system/`, `assets/` (fonts and images of published pages),
and `index.html` plus `liveframe/app/` and `liveframe/site.json` (the online Liveframe).

On a **designer's Mac**: `~/Liveframe/` (the copies, and `designs/<repo>/<design>`: each design's
folder, a git worktree of the app copy), `~/.liveframe/` (ports, logs, pictures of screens).

## License

MIT

`plugin/app/public/geist.woff2` is [Geist](https://github.com/vercel/geist-font), under the SIL Open
Font License 1.1 (`plugin/app/public/geist-OFL.txt`).
