// Opens a new session in the Claude app, in the design repo, with a first message typed in (not sent).
// The app's documented link: claude://code/new?folder=…&q=… . It asks to confirm the folder every time.

import { execFile } from "node:child_process";
import { HttpError } from "./http.mjs";

/** folder: the design's own folder (projects/<id>), so the session is that design's. */
export async function openClaude(folder, prompt) {
  const q = String(prompt ?? "").trim().slice(0, 4000);
  const link = `claude://code/new?folder=${encodeURIComponent(folder)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  if (process.env.LIVEFRAME_NO_OPEN) return { opened: false, link, folder }; // tests
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [link]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", link]] : ["xdg-open", [link]];
  await new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 10_000 }, (e) => (e ? reject(new HttpError(502, "not_opened", "Couldn't open the Claude app. Is it installed?")) : resolve())),
  );
  return { opened: true, folder };
}
