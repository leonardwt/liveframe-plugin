// Who's using Liveframe on this Mac: their GitHub account (signed in with gh, so it's verified), or
// their git name when GitHub isn't signed in. Designs record who made them; only that person works on
// a design (others make their own copy).

import { execFile } from "node:child_process";
import { git } from "./git.mjs";

let me = null;
let at = 0;

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => resolve(err ? null : String(stdout).trim())));

/** { login, name, gitName }: login is the GitHub account (null without a GitHub sign-in). */
export async function whoAmI() {
  if (me && Date.now() - at < 10 * 60_000) return me;
  const gitName = (await git(["config", "user.name"])).stdout.trim() || null;
  const out = await run("gh", ["api", "user", "--jq", "[.login, (.name // \"\")] | @tsv"]);
  const [login, name] = out ? out.split("\t") : [];
  me = login ? { login, name: name || gitName || login, gitName } : { login: null, name: gitName, gitName };
  at = Date.now();
  return me;
}

/** "Leonard Goh (leonardwt)", or just the name. */
export const labelOf = (name, login) => (name && login && name !== login ? `${name} (${login})` : name || login || null);

/** Is this design (its project.json) mine? A design that doesn't say who made it counts as mine. */
export function isMine(meta, who) {
  if (meta.designerLogin) return !!who.login && who.login.toLowerCase() === meta.designerLogin.toLowerCase();
  if (!meta.designer) return true;
  return [who.gitName, who.name, who.login].filter(Boolean).includes(meta.designer);
}
