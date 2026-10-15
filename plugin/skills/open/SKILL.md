---
name: open
description: Start Liveframe on this Mac and open it in the browser, for designing in an app's real code with Claude. The first time it checks the Mac and gets copies of the design repo and the app; after that it remembers them. Use when a designer wants to open, start or get back to Liveframe, or to see their designs. Also stops it or says whether it's running.
argument-hint: "[design repo address] | stop | status"
---

# Open Liveframe

Liveframe runs on this Mac at `http://localhost:<port>` and opens in the browser. Designs are made from there: **New design** opens Claude in the design's own folder.

Its files are in `${CLAUDE_PLUGIN_ROOT}/app`.

## Run it

The argument: `$ARGUMENTS`

- **A design repo address** (`https://github.com/<org>/<repo>`) or folder, or **nothing** (the one used last):

  ```sh
  node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" <address or nothing>
  ```

- **stop**: `node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" --stop`
- **status**: `node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" --status`

The first time, give it the design repo's address. If they don't know it, ask (whoever set Liveframe up has it). It gets copies into `~/Liveframe/` (the design repo, and the app from the address in the design repo's profile), starts Liveframe in the background and opens it. It keeps running after this session ends.

## Say what happened

In a line or two, plainly: it's running at the address, and what to do next ("Click New design, name it, and Claude opens ready to change the page you want"). No file paths unless something went wrong.

If it says the Mac needs something (Node, Chrome, GitHub sign-in, the app's package manager), list exactly what it printed and offer to help with each: most are one command (`gh auth login`, `npm install -g pnpm`). Don't install anything without asking.

If it can't get a repo, they probably don't have access on GitHub yet: say who gives it (whoever owns the repo).

If it says the design repo isn't set up yet, someone runs `/liveframe:setup` first, in the app's repo.
