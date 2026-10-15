// The idea switcher, added by Liveframe's proxy at the very start of every page of a design's app.
// It sets <html data-idea="<id>"> before the app draws (none for "before"), tells the app when it
// changes (a `liveframe:idea` event on window, with the id), and draws a small switcher at the bottom
// left, in its own shadow DOM so the app's styles and Liveframe's never mix.
//
// Which idea shows: ?idea=<id> in the address (pictures and Publish use it; no switcher then), else
// the one picked here last (this browser), else the design's "showing".
(function () {
  var d = document.documentElement;
  var KEY = "liveframe:idea";
  var params = new URLSearchParams(location.search);
  var pinned = params.get("idea");
  var state = { showing: null, ideas: [] };

  // The attribute goes on <html> only once the page has loaded: an app that renders <html> itself
  // (React) would otherwise see an attribute it didn't render while it takes the page over, and warn.
  // Until then window.__liveframeIdea already says which idea (a helper in the design reads it).
  var loaded = document.readyState === "complete";
  if (!loaded)
    window.addEventListener("load", function () {
      setTimeout(function () {
        loaded = true;
        apply(window.__liveframeIdea);
      }, 50);
    });

  function apply(id) {
    if (loaded) {
      if (!id || id === "before") d.removeAttribute("data-idea");
      else d.setAttribute("data-idea", id);
    }
    window.__liveframeIdea = id || "before";
    try {
      window.dispatchEvent(new CustomEvent("liveframe:idea", { detail: window.__liveframeIdea }));
    } catch (e) {}
  }
  function picked() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }
  function current() {
    if (pinned) return pinned;
    var ids = ["before"].concat(state.ideas.map(function (i) { return i.id; }));
    var mine = picked();
    if (mine && ids.indexOf(mine) >= 0) return mine;
    return state.showing || "before";
  }

  // Synchronously, before the app draws: what the server said when it served this page.
  var boot = window.__liveframeIdeas;
  if (boot) state = boot;
  apply(current());
  if (pinned) return;

  var host, root;
  function draw() {
    if (!document.body) return;
    if (!state.ideas.length) {
      if (host) host.remove(), (host = null);
      return;
    }
    if (!host || !host.isConnected) {
      host = document.createElement("liveframe-switcher");
      host.style.cssText = "all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647";
      root = host.attachShadow({ mode: "open" });
      document.body.appendChild(host);
    }
    var on = current();
    var opts = [{ id: "before", name: "Before", note: "The app as it is" }].concat(state.ideas);
    root.innerHTML =
      "<style>" +
      ".bar{display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(18,18,20,.92);box-shadow:0 6px 24px rgba(0,0,0,.25);font:500 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#ececef}" +
      ".lbl{padding:0 8px 0 10px;color:#8d8d96;font-size:11px;letter-spacing:.04em;text-transform:uppercase}" +
      "button{all:unset;cursor:pointer;padding:7px 11px;border-radius:999px;color:#c9c9cf;white-space:nowrap}" +
      "button:hover{background:rgba(255,255,255,.08);color:#fff}" +
      "button[aria-pressed=true]{background:#3d5bff;color:#fff}" +
      "button:focus-visible{outline:2px solid #9fb0ff;outline-offset:1px}" +
      "</style>" +
      '<div class="bar" role="group" aria-label="Ideas"><span class="lbl">Idea</span>' +
      opts
        .map(function (o) {
          var esc = function (t) { return String(t || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
          return '<button type="button" data-id="' + esc(o.id) + '" aria-pressed="' + (o.id === on) + '" title="' + esc(o.note || o.name) + '">' + esc(o.name) + "</button>";
        })
        .join("") +
      "</div>";
    root.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        try {
          localStorage.setItem(KEY, b.getAttribute("data-id"));
        } catch (e) {}
        apply(b.getAttribute("data-id"));
        draw();
      });
    });
  }

  // Keep up with Claude adding, renaming or removing ideas.
  function refresh() {
    fetch("/__liveframe/ideas", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var before = JSON.stringify(state);
        state = s && s.ideas ? s : { showing: null, ideas: [] };
        if (JSON.stringify(state) !== before) {
          apply(current());
          draw();
        }
      })
      .catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  else draw();
  // The app may redraw <body> or <html> (client-side navigation): keep the switcher and the attribute.
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (state.ideas.length && (!host || !host.isConnected)) draw();
    var want = current();
    if (loaded && (d.getAttribute("data-idea") || "before") !== want) apply(want);
  }, 1000);
  setInterval(function () {
    document.visibilityState === "visible" && refresh();
  }, 2500);
})();
