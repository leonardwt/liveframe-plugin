#!/usr/bin/env node
// Set up a design repo for an app: the app profile, the design system, the online
// pages, Liveframe's notes, then share it.
//
//   node bin/setup.mjs --app <app copy> --design <design repo copy> --profile <app.json>
//
// The profile is what Claude writes in /liveframe:setup after reading the app (how to run it, its
// pages, its tokens and components). This script does everything after that.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { app: { type: "string" }, design: { type: "string" }, profile: { type: "string" }, "no-push": { type: "boolean" } } });
if (!values.app || !values.design || !values.profile) {
  console.error("Usage: node bin/setup.mjs --app <app copy> --design <design repo copy> --profile <app.json>");
  process.exit(2);
}
process.env.LIVEFRAME_APP_REPO = path.resolve(values.app);
process.env.LIVEFRAME_DESIGN_REPO = path.resolve(values.design);
if (values["no-push"]) process.env.LIVEFRAME_NO_PUSH = "1";

const { DESIGN_REPO, APP_REPO } = await import("../lib/config.mjs");
const { git, gitOk, commitPaths, pushNow } = await import("../lib/git.mjs");

const step = (t) => console.log(`· ${t}`);

for (const [label, dir] of [["app copy", APP_REPO], ["design repo copy", DESIGN_REPO]]) {
  if ((await git(["rev-parse", "--git-dir"], { cwd: dir })).code !== 0) throw new Error(`The ${label} (${dir}) isn't a git repo.`);
}

// A new, empty design repo: its first branch is main.
if ((await git(["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) await gitOk(["symbolic-ref", "HEAD", "refs/heads/main"]);

// The profile goes in first: everything else reads it.
const profileText = fs.readFileSync(path.resolve(values.profile), "utf8");
const raw = JSON.parse(profileText);
fs.mkdirSync(path.join(DESIGN_REPO, "liveframe"), { recursive: true });
fs.writeFileSync(path.join(DESIGN_REPO, "liveframe", "app.json"), JSON.stringify(raw, null, 2) + "\n");
const { profile } = await import("../lib/profile.mjs");
const p = profile();
step(`App profile for ${p.name} (${p.repo}, ${p.branch})`);

// The app copy: up to date with GitHub, on the app's main line.
await gitOk(["fetch", "-q", "origin"], { cwd: APP_REPO });
step(`App copy up to date: ${(await gitOk(["rev-parse", "--short", `origin/${p.branch}`], { cwd: APP_REPO }))}`);

// The design repo: projects/, README, .gitignore.
fs.mkdirSync(path.join(DESIGN_REPO, "projects"), { recursive: true });
fs.writeFileSync(path.join(DESIGN_REPO, "projects", ".gitkeep"), "");
fs.writeFileSync(path.join(DESIGN_REPO, ".gitignore"), ".DS_Store\n");
fs.writeFileSync(path.join(DESIGN_REPO, "README.md"), `# ${p.name} designs

Designs for [${p.name}](${p.repo}), made with Liveframe. Designers change the app's real code with
Claude; Liveframe saves each design here and publishes versions for review. Engineers take a design
into the app when it's Ready for Development.

- \`projects/<design>/\`: a design. \`changes.patch\` is its change to the app, \`journal.md\` its
  story, \`v1/\`, \`v2/\`… its published versions, \`handoff.md\` the note for the engineer.
- \`design-system/\`: ${p.name}'s tokens and components, kept up to date from the app by Liveframe.
- \`liveframe/app.json\`: how Liveframe runs ${p.name} (the app profile).
- \`index.html\`: the online home page. The whole repo is the website: publish it as it is (no build
  step, output folder \`/\`), behind your company's sign-in.

Nothing here changes ${p.name} itself: designers only read the app's repo.
`);
step("Folders and README");

const { updateDesignSystem } = await import("../lib/design-system.mjs");
const ds = await updateDesignSystem();
step(`Design system: ${ds.changed.filter((f) => f.endsWith(".html")).length} pages from ${p.name} ${ds.sha.slice(0, 8)}`);

const { writeSite } = await import("../lib/site.mjs");
await writeSite();
step("Online home page");

const branch = (await git(["symbolic-ref", "--short", "HEAD"])).stdout.trim() || "main";
const committed = await commitPaths(["."], `Set up Liveframe for ${p.name}`);
step(committed ? `Saved on ${branch}` : "Nothing new to save");

if (!values["no-push"]) {
  const r = await pushNow();
  step(r.ok ? "Shared on GitHub" : `Not shared yet: ${r.error ?? "no remote"}`);
}
const remote = (await git(["remote", "get-url", "origin"])).stdout.trim().replace(/\.git$/, "");
console.log(`\nDone. Designers start Liveframe with /liveframe:open ${remote || DESIGN_REPO}`);
