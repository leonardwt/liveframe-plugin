// A design's proxy: what the canvas and the designer's browser open. One per running design, in
// Liveframe's own process, in front of the design's app:
//   - signs in with the profile's cookie, so every page opens signed in (no sign-in page)
//   - lets Liveframe's pages frame it (drops X-Frame-Options and frame-ancestors)
// Everything else passes through untouched, including hot reload's websocket.

import http from "node:http";
import net from "node:net";

/** "a=1; b=2" with `add` ("name=value") put in unless the request already has that cookie. */
function withCookie(header, add) {
  if (!add) return header;
  const name = add.split("=")[0].trim();
  const parts = String(header ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.split("=")[0].trim() === name)) return header;
  return [...parts, add].join("; ");
}

/** Start a design's proxy on `port`, in front of its app on `appPort`. Resolves the server once it listens. */
export function startProxy({ port, appPort, cookie, touch = () => {} }) {
  const target = { host: "127.0.0.1", port: appPort };

  const server = http.createServer((req, res) => {
    touch();
    const headers = { ...req.headers, host: `127.0.0.1:${appPort}` };
    const c = withCookie(headers.cookie, cookie);
    if (c) headers.cookie = c;
    const up = http.request({ ...target, method: req.method, path: req.url, headers }, (upRes) => {
      const out = { ...upRes.headers };
      delete out["x-frame-options"];
      if (out["content-security-policy"]) out["content-security-policy"] = String(out["content-security-policy"]).replace(/frame-ancestors[^;]*;?/i, "");
      // A redirect to the app's own address goes to the proxy's instead.
      if (out.location) out.location = String(out.location).replace(`//127.0.0.1:${appPort}`, `//localhost:${port}`).replace(`//localhost:${appPort}`, `//localhost:${port}`);
      res.writeHead(upRes.statusCode, out);
      upRes.pipe(res);
    });
    up.on("error", (err) => {
      if (res.headersSent) return res.end();
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`The design's app isn't running yet (${err.code}).`);
    });
    req.pipe(up);
  });

  // Hot reload's websocket.
  server.on("upgrade", (req, socket, head) => {
    touch();
    const up = net.connect(target.port, target.host, () => {
      const hdrs = { ...req.headers };
      const c = withCookie(hdrs.cookie, cookie);
      if (c) hdrs.cookie = c;
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`, ...Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`), "", ""];
      up.write(lines.join("\r\n"));
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
