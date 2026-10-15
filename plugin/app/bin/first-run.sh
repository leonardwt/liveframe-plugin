#!/bin/bash
# /liveframe:open's first-run check. Plain bash, so it works before Node is installed.
#
#   bash first-run.sh [--repo <design repo address>] [--tool pnpm]
#     --repo: check this GitHub account can reach it; --tool: the app's package manager, if known
#
# Prints what's here and what's missing, one line each:
#   ok   <thing> · <detail>
#   need <thing> · <why Liveframe needs it>
#   no   access to <repo> · this GitHub account can't see it (nothing to install: exits 2)
# then, when something is missing, writes ~/.liveframe/first-run-install.sh: one script that installs
# all of it, in order, and prints how it runs:
#   paste  bash ~/.liveframe/first-run-install.sh    it needs the person (their Mac password, or
#                                                    signing in to GitHub in the browser)
#   run    bash ~/.liveframe/first-run-install.sh    nothing interactive: Claude can run it
# and exits 1. Exits 0 when everything is here.

TOOL=""
REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Homebrew may be installed but not on this shell's PATH yet.
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if ! command -v brew >/dev/null 2>&1 && [ -x "$b" ]; then eval "$("$b" shellenv)"; fi
done

missing=0
interactive=0
brew_pkgs=()
casks=()
steps=()
say() { echo "$1"; }

has() { command -v "$1" >/dev/null 2>&1; }

# Homebrew: installs everything else.
if has brew; then say "ok   Homebrew · $(brew --version | head -1)"; HAVE_BREW=1; else HAVE_BREW=0; fi

# git (Apple's command line tools; Homebrew's installer brings them).
if xcode-select -p >/dev/null 2>&1 && has git; then
  say "ok   git · $(git --version)"
else
  say "need git · to get the design repo and the app, and to save designs"
  missing=1
  if [ "$HAVE_BREW" = 1 ]; then steps+=("xcode-select --install || true; echo 'Finish the Command Line Tools install in the window that opened, then run this again.'; exit 0"); interactive=1; fi
fi

# Node 22 or newer: Liveframe itself runs on it.
NODE_OK=0
if has node; then
  v=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
  if [ -n "$v" ] && [ "$v" -ge 22 ]; then NODE_OK=1; say "ok   Node · $(node -v)"; fi
fi
if [ "$NODE_OK" = 0 ]; then say "need Node 22 or newer · Liveframe runs on it"; missing=1; brew_pkgs+=(node); fi

# Google Chrome: pictures of screens, and Publish.
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  say "ok   Google Chrome"
else
  say "need Google Chrome · Liveframe uses it for pictures of screens and to publish"; missing=1; casks+=(google-chrome)
fi

# GitHub's command line tool, signed in: getting the repos, sharing designs, seeing pull requests.
GH_AUTH=0
if has gh; then
  if gh auth status >/dev/null 2>&1; then
    GH_AUTH=1
    say "ok   GitHub · signed in as $(gh api user --jq .login 2>/dev/null || echo 'you')"
  else
    say "need GitHub sign-in · to get the design repo and share your designs"; missing=1
  fi
else
  say "need GitHub's command line tool (gh), signed in · to get the design repo and share your designs"; missing=1; brew_pkgs+=(gh)
fi
if [ "$GH_AUTH" = 0 ]; then interactive=1; fi
# Can git reach the design repo with that sign-in (no password prompts)?
NO_ACCESS=0
if [ "$GH_AUTH" = 1 ] && [ -n "$REPO" ] && has git; then
  if GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO" HEAD >/dev/null 2>&1; then
    say "ok   access to $REPO"
  elif git config --global --get-all credential.https://github.com.helper 2>/dev/null | grep -q gh; then
    say "no   access to $REPO · this GitHub account can't see it: ask its owner to add you"; NO_ACCESS=1
  else
    say "need git to use your GitHub sign-in · so getting and saving designs never asks for a password"; missing=1
  fi
fi

# The app's package manager: from the design repo's app profile when we can read it.
if [ -z "$TOOL" ] && [ "$GH_AUTH" = 1 ] && [ "$NO_ACCESS" = 0 ]; then
  slug=$(printf '%s' "$REPO" | sed -nE 's#^(https://|git@)github\.com[/:]([^/]+/[^/.]+)(\.git)?/?$#\2#p')
  if [ -n "$slug" ]; then
    TOOL=$(gh api "repos/$slug/contents/liveframe/app.json" --jq .content 2>/dev/null | base64 -d 2>/dev/null | tr -d '\n' | sed -nE 's/.*"install"[[:space:]]*:[[:space:]]*\[[[:space:]]*"([^"]+)".*/\1/p')
  fi
fi
case "$TOOL" in
  ""|npm|npx) ;;
  *)
    if has "$TOOL"; then say "ok   $TOOL · $("$TOOL" --version 2>/dev/null | head -1)"
    else say "need $TOOL · the app installs its packages with it"; missing=1; brew_pkgs+=("$TOOL"); fi ;;
esac

if [ "$missing" = 0 ]; then
  if [ "$NO_ACCESS" = 1 ]; then exit 2; fi
  say "All set."
  exit 0
fi

if [ "$HAVE_BREW" = 0 ]; then say "need Homebrew · installs the others (it asks for your Mac password once)"; fi

# One script that installs all of it, in order.
mkdir -p "$HOME/.liveframe"
S="$HOME/.liveframe/first-run-install.sh"
{
  echo '#!/bin/bash'
  echo '# Installs what Liveframe needs on this Mac (written by /liveframe:open).'
  echo 'set -e'
  echo 'echo "Setting up this Mac for Liveframe…"'
  if [ "$HAVE_BREW" = 0 ]; then
    interactive=1
    echo 'echo "1. Homebrew (it asks for your Mac password once)"'
    echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  fi
  echo 'for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done'
  echo 'grep -q "brew shellenv" "$HOME/.zprofile" 2>/dev/null || echo "eval \"\$($(command -v brew) shellenv)\"" >> "$HOME/.zprofile"'
  for s in "${steps[@]}"; do echo "$s"; done
  if [ ${#brew_pkgs[@]} -gt 0 ]; then echo "echo \"Installing: ${brew_pkgs[*]}\""; echo "brew install ${brew_pkgs[*]}"; fi
  if [ ${#casks[@]} -gt 0 ]; then echo "echo \"Installing: ${casks[*]}\""; echo "brew install --cask ${casks[*]}"; fi
  if [ "$GH_AUTH" = 0 ]; then
    echo 'echo "Signing in to GitHub (your browser opens; pick HTTPS if it asks)"'
    echo 'gh auth login --hostname github.com --git-protocol https --web'
  fi
  echo 'gh auth setup-git --hostname github.com'
  echo 'echo ""'
  echo 'echo "Done. Go back to Claude and say done."'
} > "$S"
chmod +x "$S"
if [ "$interactive" = 1 ]; then say "paste  bash ~/.liveframe/first-run-install.sh"; else say "run    bash ~/.liveframe/first-run-install.sh"; fi
exit 1
