---
name: open
description: Start Liveframe on this Mac and open it in the browser, for designing in an app's real code with Claude. The first time it checks the Mac, installs what's missing in one go (with one yes), and gets copies of the design repo and the app; after that it remembers them. Use when a designer wants to open, start or get back to Liveframe, or to see their designs. Also stops it or says whether it's running.
argument-hint: "[design repo address] | stop | status"
---

# Open Liveframe

Liveframe runs on this Mac at `http://localhost:<port>` and opens in the browser. Designs are made from there: **New design** opens Claude in the design's own folder.

Its files are in `${CLAUDE_PLUGIN_ROOT}/app`. The argument: `$ARGUMENTS`

- **stop**: `node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" --stop`, then say it's stopped.
- **status**: `node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" --status`, then say what it printed.
- Otherwise it's **a design repo address** (`https://github.com/<org>/<repo>`) or folder, or **nothing** (the one used last). Do the steps below.

The person is probably a designer: plain words, no jargon, and never a pile of instructions one at a time.

## 1. Check the Mac (always, it's quick)

```sh
bash "${CLAUDE_PLUGIN_ROOT}/app/bin/first-run.sh" --repo <the design repo address, if you have one>
```

It prints one line per thing (`ok`, `need`, `no`) and ends with **All set.**, or with how to install what's missing.

- **All set.** Go to step 2 without saying anything about it.
- **`need` lines.** Ask **once**, in one short message: "Liveframe needs a few things on this Mac:" then one bullet per `need` line in plain words (what it is, and the reason after the `·`), then "Install them all?". Wait for the answer.
  - If the last line starts with **`run`**: nothing in it needs them. Run `bash ~/.liveframe/first-run-install.sh` yourself, then check again.
  - If it starts with **`paste`**: it needs them (their Mac password, or signing in to GitHub in the browser). Tell them, in three lines: open the **Terminal** app, paste `bash ~/.liveframe/first-run-install.sh` and press Return; it asks for their Mac password once and opens GitHub in the browser to sign in; tell me "done" when it says Done. When they say done, check again. A check that now only needs things you can install (it ends with `run`) is part of the same yes: run it, don't ask again.
- **A `no access` line.** Nothing to install: their GitHub account can't see the design repo. Say who can fix it (whoever owns the repo adds them), and stop.

## 2. Start it

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/open.mjs" <address, or nothing>
```

The first time it gets copies into `~/Liveframe/` (the design repo, and the app from the address in the design repo's profile), starts Liveframe in the background and opens it. It keeps running after this session ends.

- If it says the app's package manager is missing, run the install command it gives (it's covered by their yes), then run it again.
- If it can't get a repo, their GitHub account probably can't see it yet: say who can fix it.
- If it says the design repo isn't set up yet, someone runs `/liveframe:setup` first, in the app's repo.

## 3. Say what happened

One or two lines: it's running (the address), and what to do next: "Click **New design**, name it, and Claude opens ready to change the page you want." No file paths unless something went wrong.
