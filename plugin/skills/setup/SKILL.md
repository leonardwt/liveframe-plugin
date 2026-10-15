---
name: setup
description: Set up Liveframe for an app, once per app. Reads the app's code, writes the app profile (how to run it, its pages, its tokens and components, sign-in, what's frontend and backend), proves it by running the app, then fills the empty design repo and shares it. Use when someone asks to set up Liveframe, add Liveframe to an app, or prepare a design repo. Run it in a copy of the app's repo.
argument-hint: <design repo: GitHub address or folder>
disable-model-invocation: true
---

# Set up Liveframe for an app

Liveframe lets designers change this app's real code with Claude, on their own Mac. It keeps designs in a separate **design repo** and only ever reads the app's repo. This sets that up, once per app. Talk plainly: the person running it may be a designer.

Liveframe's files are in `${CLAUDE_PLUGIN_ROOT}/app`. The example profile is `${CLAUDE_PLUGIN_ROOT}/app/examples/app.example.json`.

## 0. Check where you are

- You need to be in a copy of the **app's** repo (a git repo with a GitHub remote). If not, ask where it is.
- The design repo is the argument: `$ARGUMENTS`. It should be **empty** (just created on GitHub). If it's a GitHub address, clone it next to the app's copy (`git clone <address> ../<name>`). If no argument was given, ask for it. If it already has `liveframe/app.json`, it's set up: say so and suggest `/liveframe:open` instead.
- Say in two lines what you're about to do: read the app, write its profile, try it, fill the design repo.

## 1. Read the app

Read, don't guess. Find:

- **The main line**: the branch work merges into (`git remote show origin`; often `main`, sometimes `dev`).
- **How it runs locally**: the package manager (from the lockfile), the install command, the dev command. The dev command must take a port Liveframe chooses: write it with `{port}` (e.g. `["node_modules/.bin/next", "dev", "-H", "127.0.0.1", "-p", "{port}"]`), and bind to 127.0.0.1 where the tool allows it. Use the binary in `node_modules/.bin` rather than a script that hard-codes a port.
- **Environment**: anything the app needs to start (`.env.example`, config files, README). Only values that are safe to share: test, mock or local ones. Never real keys or production addresses. If it needs a real secret to run at all, stop and say so (see "Doesn't fit").
- **Data**: where the frontend gets its data. Liveframe works when the app runs on one Mac with no real backend: its own dev backend, built-in mocks, fixtures, test accounts. Say which.
- **Sign-in**: how a page is reached signed in, with no sign-in page. Liveframe sends one cookie with every request (`"signIn": { "cookie": "name=value" }`), so find a test account and the cookie that signs it in (read the sign-in code). No sign-in: leave it out.
- **Frontend and backend**: folders and files designs may change (`frontend`) and never change (`backend`: API routes, server code, data access, middleware). Specific enough that a Ready for Development check can tell them apart.
- **Pages**: 5–10 main pages a designer would start from, with their addresses and plain names. Pages that need an id: use one that exists in the test data.
- **The design system**: the file(s) where the tokens are, as CSS custom properties (`--color-…`, `--font-…`, `--space-…`), and the folder(s) of UI components (buttons, inputs, cards: the library, not page parts). If the tokens are only in a JS/TS theme, name the file anyway and say the token pages will be empty for now.
- **Notes**: 2–4 sentences for the Claude that designs in this app later: the stack, the styling rules, where components come from, which test accounts show which states.

## 2. Write the profile

Write it to `<design repo>/liveframe/app.json` in the shape of the example (`name`, `repo`, `branch`, `install`, `run`, `env`, `ready`, `signIn`, `frontend`, `backend`, `pages`, `designSystem`, `notes`; `site` comes later with hosting).

## 3. Try it

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/check-profile.mjs" --app . --profile <design repo>/liveframe/app.json
```

It runs the app from a scratch copy of the main line the way the profile says, opens every page signed in, and reads the tokens and components. Fix the profile and run it again until it says **The profile works**. A page that sends to sign-in means the cookie is wrong; a page that fails may need a different id.

Then tell the person, in plain words, what fits and what doesn't: the pages that open, how many tokens and components it found, anything left out and why.

### Doesn't fit

Some apps can't run on a Mac without their real backend or real secrets. Then **stop**: say plainly that this version of Liveframe needs the app to run locally on test data, what's missing (a mock API, test accounts, a local backend), and that an engineer could add it. Don't write a profile that only half works.

## 4. Fill the design repo and share it

```sh
node "${CLAUDE_PLUGIN_ROOT}/app/bin/setup.mjs" --app . --design <design repo> --profile <design repo>/liveframe/app.json
```

It writes the design system (token pages and a page per component, from the main line), the online home page and a README, commits and pushes. Say what it made.

## 5. What's next

Tell them, briefly:

1. **Designers**: they need read access to the app's repo and write access to the design repo on GitHub. Each one installs the plugin and runs `/liveframe:open <design repo address>`.
2. **Reviewers online** (optional, ~30 minutes, free for up to 50 people): host the design repo as a website behind your company's sign-in. On Cloudflare: Workers & Pages → Create → **Continue to Pages** → Import an existing Git repository → give Cloudflare's GitHub app access to **only** the design repo → production branch = the design repo's branch, framework **None**, build command `exit 0`, output directory `/`. Then lock it in Zero Trust (Free plan): **Restrict previews** in the Pages project's settings, plus a **self-hosted application** for `<project>.pages.dev` with an Allow policy "Emails ending in @<company domain>". Then add `"site": "https://<project>.pages.dev"` to `liveframe/app.json` and push.
3. **Engineers** take finished designs with `/liveframe:take <design>` in the app's repo.
