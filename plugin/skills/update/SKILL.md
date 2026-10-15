---
name: update
description: Check whether there's a newer Liveframe, say in plain words what's new in it, and update it (restarting Liveframe) when the person says yes. Use when someone asks to update Liveframe or the Liveframe plugin, asks if there's a new version, or what's new in Liveframe.
argument-hint: ""
---

# Update Liveframe

## 1. Check

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/update.mjs"
```

- **Up to date**: say so in one line (with the version) and stop.
- **Update available** (it prints the two versions and what's new): tell them in a short message: the versions, then what's new as a few plain bullets (merge the notes of every version in between, newest first, and keep the designer's point of view: what they'll see or can do now). Then ask: "Update now?"
- **Couldn't check**: say why in a line (usually offline).

## 2. Update (after a yes)

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/update.mjs" --apply
```

It updates the plugin and restarts any Liveframe running on this Mac on the new version. Then say, in two lines: it's updated (the new version), Liveframe was restarted if it was running, and to start a **new Claude session** so the new version's commands are used (this one still has the old ones).

If it fails, say what it printed and that they can try again later.
