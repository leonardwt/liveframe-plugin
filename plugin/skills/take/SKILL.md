---
name: take
description: Bring a finished Liveframe design into the app as a pull request, for the engineer. Makes a branch with the design's change and its handoff note, moved onto the app's latest, opens the pull request, then helps with what the note leaves open. Use when an engineer wants to take, pick up, build or merge a design that's Ready for Development. Run it in the app's repo.
argument-hint: <design> [design repo address]
disable-model-invocation: true
---

# Take a design

A designer made this design in the app's real code with Liveframe and marked it **Ready for Development**. Its change, its handoff note and its published screens are in the design repo. This brings it into the app the normal way: a branch and a pull request. When the pull request is merged, Liveframe archives the design by itself.

The arguments: `$ARGUMENTS` (the design's name, as in its address in the design repo, e.g. `simpler-sign-up`, then the design repo's address if given). If the design repo's address isn't given, ask for it: it's on the design's handoff page ("To take it…").

## 1. Check where you are

You need to be in the app's repo, with nothing uncommitted. If there's uncommitted work, stop and say so.

## 2. Take it

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/take.mjs" <design> --design <design repo address>
```

It makes the branch `design/<design>` from the commit the design started from, applies the design's change with the handoff note as the commit message, moves it onto the app's main line, pushes, and opens the pull request.

- **"The app changed in the same places"**: the rebase stopped on a clash. Show the files (`git status`), sort it out keeping what the design meant (the note says what that is), `git rebase --continue`, then `git push -u origin design/<design>` and `gh pr create` with the note as the body.
- **"isn't Ready for Development yet"**: the designer hasn't sent it. Say so.

## 3. What's left

Read the handoff note (the pull request's description) and go through it with the engineer:

- **For the engineer**: data the design needs, backend work, open questions. Offer to do each, one at a time.
- **Design system**: new or changed tokens and components, raw values. Point them out; whoever owns the design system decides.
- **The app's own checks**: run them (typecheck, lint, tests, build: whatever the app has) and fix what the design broke.

Then the pull request goes through review like any other. Merging it archives the design in Liveframe.
