# What's new in Liveframe

Written for designers: what changed for you. `/liveframe:update` shows the parts newer than yours.

## 0.4.1

- **Publish is about 6× faster**: each screen opens once (not three times), three at a time. A
  design with 9 screens and one idea went from about 3 minutes to 30 seconds.

## 0.4.0

- **Who made it**: every design shows its designer, with their GitHub account ("Leonard (leonardwt)"),
  on the designs page and next to the version on the canvas, here and online. Liveframe takes it from
  your GitHub sign-in (your git name if you're not signed in).
- **One designer per design**: someone else's design opens read-only. **Make my own copy** starts a
  design of yours where theirs is (same change, screens and ideas), and Claude opens in it. Theirs
  stays theirs.

## 0.3.1

- **`/liveframe:update`**: checks for a new Liveframe, tells you what's new, and updates it (and
  restarts Liveframe) when you say yes.

## 0.3.0

- **The online site is Liveframe itself**, read-only: the same designs page and canvas reviewers see,
  without New design, Design with Claude, Publish or Ready for Development. The version picker
  switches the canvas between published versions.
- **Phone view online**: Publish also takes phone-size pictures.
- **No more tug of war**: an older Liveframe on someone else's Mac no longer rewrites the online site
  or the design system pages made by a newer one.
- The handoff note page has Liveframe's dark look.

## 0.2.0

- **Ideas side by side** (`/liveframe:variants`): ask for variants and Claude builds them behind a
  switcher over the app; the canvas shows a row per idea; Publish saves every idea. Pick the winner
  and Claude takes the rest out. Ready for Development waits until one idea is left.

## 0.1.1

- **The first `/liveframe:open` sets up your Mac in one go**: it lists everything missing, asks once,
  and installs it (one command to paste for the parts that need your password or a GitHub sign-in).

## 0.1.0

- First version: `/liveframe:setup`, `/liveframe:open`, `/liveframe:take`; designing in the app's real
  code with Claude, Publish, Ready for Development, the design system pages.
