// Liveframe's pages: the designs (/) and a design (/d/<id>): its screens, Publish and Ready for
// Development. Plain DOM, no build step.

import { flowCanvas, editable } from "/assets/flow.js";

const root = document.getElementById("root");

// ---------- small helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

function icon(name, size = 16) {
  const paths = {
    logo: '<rect x="3" y="4" width="18" height="16" rx="4"/><circle cx="12" cy="14" r="2.2" fill="#3d5bff" stroke="none"/>',
    desktop: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    claude: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
    components: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7.8" r="1.2" fill="currentColor" stroke="none"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  return h("span", { "aria-hidden": "true", style: "display:inline-flex", html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>` });
}

async function api(path, options) {
  const res = await fetch(path, options?.body ? { method: "POST", headers: { "content-type": "application/json" }, ...options, body: JSON.stringify(options.body) } : options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || "Something went wrong."), { code: data.error });
  return data;
}

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

let toastTimer;
function toast(text, error = false, ms = 3600) {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast${error ? " toast--error" : ""}`, role: "status" }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

function go(path) {
  history.pushState(null, "", path);
  route();
}

function brand() {
  return h("a", { class: "brand tip-start", href: "/", "data-tip": "All designs", onclick: (e) => (e.preventDefault(), go("/")) }, icon("logo", 18), h("span", { class: "brand__name" }, "Liveframe"));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function modal(label, ...kids) {
  const close = () => (back.remove(), document.removeEventListener("keydown", onKey));
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  const back = h("div", { class: "modal-back", onclick: (e) => e.target === back && close() }, h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": label }, ...kids));
  document.body.append(back);
  return close;
}

// ---------- settings and live updates ----------

let settings = { app: null, site: null, online: null, designSystem: null };
const loadSettings = () => api("/api/settings").then((s) => (settings = s)).catch(() => settings);

let onEvent = () => {};
const events = new EventSource("/api/events");
events.onmessage = (e) => {
  try {
    onEvent(JSON.parse(e.data));
  } catch {}
};

/** The site's page for a path in the design repo: online when it's set up, else served by Liveframe. */
const siteLink = (rel) => (settings.online ? settings.online.replace(/\/?$/, "/") : settings.site) + rel;

function designSystemButton(kind = "components", label = "Design system") {
  const href = settings.designSystem?.[kind];
  return h("a", { class: "btn btn--ghost", href: href ?? "#", target: "_blank", rel: "noopener", "aria-disabled": href ? null : "true" }, icon(kind === "tokens" ? "palette" : "components", 14), label);
}

// ---------- home ----------

async function home() {
  document.title = "Liveframe";
  const body = h("div", { class: "home__wide" });
  const head = h("header", { class: "bar" });
  root.replaceChildren(h("div", { class: "home" }, head, h("main", { class: "home__body" }, body)));

  async function draw() {
    await loadSettings();
    head.replaceChildren(brand(), h("span", { class: "crumb" }, "/"), h("span", { class: "bar__title" }, settings.app ? `${settings.app} designs` : "Designs"), h("span", { class: "spacer" }), designSystemButton());
    let designs;
    try {
      designs = await api("/api/projects");
    } catch (err) {
      body.replaceChildren(h("p", { class: "muted" }, err.message));
      return;
    }
    const top = h("div", { class: "home__head" },
      h("h1", null, "Designs"),
      h("span", { class: "spacer" }),
      settings.online ? h("a", { class: "btn btn--ghost", href: settings.online, target: "_blank", rel: "noopener" }, icon("external", 14), "Online") : null,
      h("button", { type: "button", class: "btn btn--primary", onclick: () => newDesign() }, icon("plus", 14), "New design"));
    const open = designs.filter((d) => d.status !== "archived");
    const done = designs.filter((d) => d.status === "archived");
    if (!designs.length) {
      body.replaceChildren(top,
        h("button", { type: "button", class: "dcard dcard--empty", onclick: () => newDesign() },
          icon("plus", 18),
          h("strong", null, "Start your first design"),
          h("span", null, "Name it, and Claude opens ready to change the page you want.")));
      return;
    }
    body.replaceChildren(top,
      open.length ? h("div", { class: "dgrid" }, open.map(card)) : h("p", { class: "muted" }, "Nothing in progress."),
      done.length ? h("h2", { class: "home__sub" }, "Archived · built") : null,
      done.length ? h("div", { class: "dgrid" }, done.map(card)) : null);
  }

  onEvent = (e) => !["pictures", "app", "publishing", "handoff"].includes(e.type) && draw();
  await draw();
}

function card(d) {
  const chips = [];
  if (d.status === "archived") chips.push(h("span", { class: "dchip" }, "Built"));
  else if (d.status === "ready") chips.push(h("span", { class: "dchip dchip--ready" }, `Ready for Development · v${d.ready.version}`));
  else if (d.latestVersion) chips.push(h("span", { class: "dchip" }, `v${d.latestVersion.n}${d.unpublished ? " · changed since" : ""}`));
  else chips.push(h("span", { class: "dchip dchip--draft" }, "Not published yet"));
  const href = `/d/${encodeURIComponent(d.id)}`;
  return h("a", { class: "dcard", href, onclick: (e) => (e.preventDefault(), go(href)) },
    h("div", { class: `dcard__cover${d.status === "ready" ? " dcard__cover--ready" : ""}` },
      icon("logo", 18),
      h("div", { class: "dcard__chips" }, chips),
      h("div", { class: "dcard__title" }, d.title)),
    h("div", { class: "dcard__foot" },
      h("div", { class: "dcard__brief" }, d.brief || `${plural(d.screens.length, "screen")}`),
      h("div", { class: "dcard__meta" }, d.status === "archived" ? `Built ${ago(d.archivedAt)}` : d.savedAt ? `Changed ${ago(d.savedAt)}` : "")));
}

function folderName(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

function newDesign() {
  const name = h("input", { class: "field", placeholder: "e.g. Simpler sign-up", maxlength: "80", "aria-label": "Name", autocomplete: "off" });
  const brief = h("textarea", { class: "field field--area", rows: "3", placeholder: "What do you want to change? (optional) e.g. Make the sign-up page shorter and friendlier", "aria-label": "What do you want to change?" });
  const create = h("button", { type: "submit", class: "btn btn--primary", disabled: true }, icon("claude", 14), "Create and open Claude");
  const error = h("p", { class: "form-error", hidden: true });
  name.oninput = () => {
    create.disabled = !folderName(name.value);
    error.hidden = true;
  };
  let close;
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    create.disabled = true;
    try {
      const d = await api("/api/projects", { body: { name: name.value, brief: brief.value } });
      close();
      go(`/d/${encodeURIComponent(d.id)}`);
      openClaude(d.id, true);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      create.disabled = false;
    }
  } },
    name, brief, error,
    h("div", { class: "row-end" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => close() }, "Cancel"), create));
  close = modal("New design", h("h2", null, "New design"), h("p", null, "Give it a name, and say what you want to change. Claude opens in the design's own copy of the app."), form);
  name.focus();
}

async function openClaude(id, start = false) {
  try {
    await api(`/api/projects/${encodeURIComponent(id)}/claude`, { body: { start } });
    toast("Opening Claude… Confirm the folder when it asks, then send the message.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- a design ----------

const prefs = {
  get device() {
    try {
      return localStorage.getItem("lf:device") || "desktop";
    } catch {
      return "desktop";
    }
  },
  set device(v) {
    try {
      localStorage.setItem("lf:device", v);
    } catch {}
  },
};

async function design(id) {
  const state = { d: null, device: prefs.device, pop: null, canvas: null, pictures: null, publishing: null };
  const bar = h("header", { class: "bar" });
  const note = h("div", { class: "viewing", hidden: true });
  const stage = h("main", { class: "stage stage--flow" });
  root.replaceChildren(h("div", { class: "design" }, bar, note, stage));
  document.onpointerdown = (e) => {
    if (state.pop && !e.target.closest(".pop-anchor")) (state.pop = null), drawBar();
  };
  const enc = encodeURIComponent(id);

  async function load() {
    try {
      [state.d] = await Promise.all([api(`/api/projects/${enc}`), loadSettings()]);
    } catch (err) {
      root.replaceChildren(h("div", { class: "home" }, h("header", { class: "bar" }, brand()), h("main", { class: "home__body" }, h("div", { class: "home__wide" }, h("p", { class: "muted" }, err.message)))));
      return false;
    }
    document.title = `${state.d.title} · Liveframe`;
    if (state.d.status === "designing") keepRunning();
    return true;
  }

  // The design's app runs while it's open here: started when the canvas opens and when you come back
  // to its tab; in between the canvas only asks how it's doing.
  let keeping = false;
  function keepRunning() {
    if (keeping) return;
    keeping = true;
    const url = `/api/projects/${enc}/app`;
    const here = () => stage.isConnected && state.d?.id === id;
    const check = async (start) => {
      try {
        state.d.app = await api(url, start ? { body: {} } : undefined);
        state.canvas?.updatePictures();
      } catch {}
    };
    const onShow = () => (here() ? document.visibilityState === "visible" && check(true) : document.removeEventListener("visibilitychange", onShow));
    document.addEventListener("visibilitychange", onShow);
    const tick = async (start) => {
      if (!here()) return void ((keeping = false), document.removeEventListener("visibilitychange", onShow));
      await check(start);
      setTimeout(tick, state.d.app?.state === "ready" ? 20_000 : 3_000);
    };
    tick(document.visibilityState === "visible");
  }

  const viewportOf = () => (state.device === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  async function loadPictures() {
    if (state.d.status === "archived") return;
    const { width, height } = viewportOf();
    const size = `${width}x${height}`;
    try {
      const { pictures } = await api(`/api/projects/${enc}/pictures?w=${width}&h=${height}`);
      if (`${viewportOf().width}x${viewportOf().height}` !== size) return;
      state.pictures = { size, stamps: pictures };
      state.canvas?.updatePictures();
    } catch {}
  }
  const pictureOf = (c) => {
    const { width, height } = viewportOf();
    const p = state.pictures;
    const stamp = p?.size === `${width}x${height}` ? p.stamps[c.page] : null;
    if (stamp) return `http://127.0.0.1:${location.port}/view/pictures/${enc}/${encodeURIComponent(c.page)}@${width}x${height}.jpg?v=${stamp}`;
    // An archived design: its last published pictures.
    const v = state.d.latestVersion;
    const shot = v?.screens?.find((s) => s.page === c.page)?.picture;
    return state.d.status === "archived" && shot ? `${settings.site}projects/${enc}/v${v.n}/${encodeURIComponent(shot)}` : null;
  };

  function groups() {
    const d = state.d;
    const live = d.status === "designing";
    const v = d.latestVersion;
    const cards = d.screens.map((s) => ({
      page: s.page,
      title: s.name,
      rename: live ? { page: s.page } : null,
      note: s.route,
      thumb: "about:blank",
      href: live ? `${d.app.url}${s.route}` : v ? `${settings.site}projects/${enc}/v${v.n}/${encodeURIComponent(s.page)}.html` : "#",
    }));
    return [{ title: "Screens", sub: plural(cards.length, "screen"), rows: [{ cards }] }];
  }

  function drawStage({ keep = false } = {}) {
    const d = state.d;
    if (!d.screens.length) {
      state.canvas?.destroy();
      state.canvas = null;
      stage.replaceChildren(h("div", { class: "stage__wait" },
        h("strong", null, "No screens yet"),
        h("span", null, d.status === "designing" ? "Design with Claude and tell it which page you want to change. It shows here as soon as Claude adds it." : "This design has no screens.")), toolbar());
      return;
    }
    const shape = JSON.stringify([d.id, d.screens, d.status, state.device]);
    if (keep && state.canvas?.shape === shape) return;
    const camera = keep ? state.canvas?.camera() : null;
    state.canvas?.destroy();
    const phone = state.device === "phone";
    state.canvas = flowCanvas({
      groups: groups(),
      viewport: viewportOf(),
      camera,
      pictures: pictureOf,
      appStatus: () => (state.d.status === "designing" && state.d.app && state.d.app.state !== "ready" ? state.d.app : null),
      onOpen: (c, e) => {
        if (!phone || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        window.open(c.href, "_blank", "popup,noopener,width=390,height=844");
      },
      onRename: renameIt,
      onEditEnd: () => state.later && !state.canvas?.editing() && ((state.later = false), refresh()),
    });
    state.canvas.shape = shape;
    loadPictures();
    stage.replaceChildren(state.canvas.el, toolbar());
  }

  // Floating over the canvas: the screens' width, and links to the design system (it's the app's, not this design's).
  function toolbar() {
    const tool = (label, tip, onclick, ...kids) => h("button", { type: "button", class: "ftool__btn tip-up", "aria-label": label, "data-tip": tip, onclick }, ...kids);
    const link = (kind, label, tip, ic) => h("a", { class: "ftool__btn tip-up", href: settings.designSystem?.[kind] ?? "#", target: "_blank", rel: "noopener", "aria-label": label, "data-tip": tip }, icon(ic, 16));
    return h("div", { class: "ftool", role: "toolbar", "aria-label": "Canvas" },
      h("div", { class: "ftool__seg", role: "group", "aria-label": "Width" },
        [["desktop", "Desktop", "Desktop: screens open in a new tab"], ["phone", "Phone", "Phone: screens open in a phone-size window"]].map(([key, label, tip]) => {
          const b = tool(label, tip, () => ((state.device = prefs.device = key), drawStage()), icon(key, 16));
          b.setAttribute("aria-pressed", String(state.device === key));
          return b;
        })),
      h("span", { class: "ftool__sep", "aria-hidden": "true" }),
      link("components", "Design system (opens a new tab)", "Design system · opens a new tab", "components"),
      link("tokens", "Tokens (opens a new tab)", "Tokens · opens a new tab", "palette"));
  }

  async function renameIt(what, name) {
    try {
      await api(`/api/projects/${enc}/rename`, { body: { what, name } });
    } catch (err) {
      toast(err.message, true);
      throw err;
    }
  }

  function drawNote() {
    const d = state.d;
    const parts = [];
    if (d.status === "ready") {
      parts.push(h("span", null, `With engineering since ${ago(d.ready.at)}: v${d.ready.version} is Ready for Development. It doesn't change from here on.`),
        h("a", { href: siteLink(`projects/${enc}/handoff.html`), target: "_blank", rel: "noopener" }, "Handoff note"),
        d.pr ? h("a", { href: d.pr, target: "_blank", rel: "noopener" }, "Pull request") : h("span", { class: "muted" }, "Waiting for the engineer to take it."));
    } else if (d.status === "archived") {
      parts.push(h("span", null, `Built ${ago(d.archivedAt)}. Archived: nothing changes from here on.`),
        d.latestVersion ? h("a", { href: siteLink(`projects/${enc}/v${d.latestVersion.n}/index.html`), target: "_blank", rel: "noopener" }, `v${d.latestVersion.n}`) : null,
        d.pr ? h("a", { href: d.pr, target: "_blank", rel: "noopener" }, "Pull request") : null);
    } else if (state.publishing) {
      parts.push(h("span", null, `Publishing… ${state.publishing.done} of ${plural(state.publishing.total, "screen")} saved`));
    }
    note.hidden = !parts.length;
    note.replaceChildren(...parts);
  }

  function drawBar() {
    const d = state.d;
    const live = d.status === "designing";
    const last = d.latestVersion;

    const versions = d.versions.length
      ? h("select", { class: "vpick", "aria-label": "Published versions", onchange: (e) => {
        const n = e.target.value;
        e.target.value = "";
        if (n) window.open(siteLink(`projects/${enc}/v${n}/index.html`), "_blank", "noopener");
      } },
        h("option", { value: "" }, `${plural(d.versions.length, "version")} · open one`),
        [...d.versions].reverse().map((v) => h("option", { value: v.n }, `v${v.n} · ${v.name}`)))
      : h("span", { class: "muted hide-narrow" }, "Not published yet");

    let actions = [];
    if (live) {
      const publishTip = !d.screens.length ? "No screens yet" : !d.unpublished ? `Nothing new since v${last?.n}` : state.publishing ? "Publishing…" : null;
      const publishBtn = h("button", { type: "button", class: "btn", disabled: !!publishTip, "aria-expanded": String(state.pop === "publish"), onclick: () => ((state.pop = state.pop === "publish" ? null : "publish"), drawBar()) },
        d.unpublished && d.screens.length ? h("span", { class: "dot" }) : null, "Publish");
      actions.push(h("span", { class: "pop-anchor" },
        publishTip ? h("span", { class: "tip-wrap tip-end", "data-tip": publishTip }, publishBtn) : publishBtn,
        state.pop === "publish" ? publishPop() : null));
      const readyTip = !last ? "Publish a version first" : d.unpublished ? `Changed since v${last.n}: publish again first` : null;
      const b = h("button", { type: "button", class: "btn btn--primary", disabled: !!readyTip, onclick: () => readyModal() }, "Ready for Development");
      actions.push(readyTip ? h("span", { class: "tip-wrap tip-end", "data-tip": readyTip }, b) : b);
    } else {
      actions.push(h("button", { type: "button", class: "btn btn--done", disabled: true }, icon("check", 14), d.status === "ready" ? `Ready for Development · v${d.ready.version}` : "Built"));
    }

    bar.replaceChildren(...[
      brand(),
      h("span", { class: "crumb" }, "/"),
      live ? editable(h("span", { class: "bar__title" }, d.title), { onSave: async (name) => (await renameIt({ title: true }, name), (document.title = `${name} · Liveframe`)) }) : h("span", { class: "bar__title" }, d.title),
      live ? h("button", { type: "button", class: "btn tip-start", "data-tip": "A new Claude session for this design", onclick: () => openClaude(d.id, !d.screens.length) }, icon("claude", 14), h("span", { class: "hide-narrow" }, "Design with Claude")) : null,
      versions,
      h("span", { class: "spacer" }),
      ...actions,
    ].filter(Boolean));
    bar.querySelector(".pop input")?.focus();
  }

  function publishPop() {
    const d = state.d;
    const n = (d.latestVersion?.n ?? 0) + 1;
    const input = h("input", { class: "field", placeholder: n === 1 ? "First look" : "What's it for? e.g. For the team review", maxlength: "120", "aria-label": "Version name" });
    const submit = async (e) => {
      e.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      state.pop = null;
      state.publishing = { done: 0, total: d.screens.length };
      drawBar();
      drawNote();
      try {
        const r = await api(`/api/projects/${enc}/publish`, { body: { name: input.value } });
        const where = settings.online ? "It's online in a minute or two." : r.pushed ? "Shared on GitHub." : `Saved here, not shared yet: ${r.pushError ?? "no GitHub"}.`;
        toast(`Published v${r.version.n} · ${r.version.name}. ${where}`, false, 6000);
      } catch (err) {
        toast(err.message, true);
      }
      state.publishing = null;
      await refresh();
    };
    const form = h("form", { class: "pop", onsubmit: submit, onkeydown: (e) => e.key === "Escape" && ((state.pop = null), drawBar()) },
      h("h3", null, `Publish v${n}`),
      h("p", null, `Saves ${plural(d.screens.length, "screen")} as they are now and puts them online for review. You can keep designing.`),
      input,
      h("div", { class: "row-end" },
        h("button", { type: "button", class: "btn btn--ghost", onclick: () => ((state.pop = null), drawBar()) }, "Cancel"),
        h("button", { type: "submit", class: "btn btn--primary" }, "Publish")));
    return form;
  }

  async function readyModal() {
    const d = state.d;
    const list = h("ul", { class: "checks" }, ["Published", "Up to date with the app", "Only the frontend", "Design system"].map((label) =>
      h("li", { class: "check check--wait" }, h("span", { class: "check__icon" }), h("div", null, h("div", { class: "check__label" }, label), h("div", { class: "check__detail" }, "Checking…")))));
    const send = h("button", { type: "button", class: "btn btn--primary", disabled: true }, "Send to development", icon("send", 14));
    const status = h("p", { class: "muted", hidden: true });
    let close;
    close = modal("Ready for Development",
      h("h2", null, "Ready for Development"),
      h("p", null, `v${d.latestVersion.n} · ${d.latestVersion.name} goes to engineering with a handoff note Claude writes from the journal. The design doesn't change from here on.`),
      list,
      status,
      h("div", { class: "row-end" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => close() }, "Cancel"), send));

    let check;
    try {
      check = await api(`/api/projects/${enc}/ready`);
    } catch (err) {
      list.replaceChildren(h("li", { class: "check check--fail" }, h("span", { class: "check__icon" }, "!"), h("div", null, h("div", { class: "check__label" }, "Couldn't check"), h("div", { class: "check__detail" }, err.message))));
      return;
    }
    list.replaceChildren(...check.results.map((r) =>
      h("li", { class: `check check--${r.status}` },
        h("span", { class: "check__icon" }, r.status === "pass" ? "✓" : r.status === "note" ? "i" : "!"),
        h("div", null,
          h("div", { class: "check__label" }, r.label),
          h("div", { class: "check__detail" }, r.detail),
          r.items?.length ? h("ul", { class: "check__items" }, r.items.map((it) => h("li", null, it))) : null))));
    send.disabled = !check.canSend;
    send.onclick = async () => {
      send.disabled = true;
      status.hidden = false;
      status.textContent = "Claude is writing the handoff note… (about a minute)";
      try {
        const r = await api(`/api/projects/${enc}/ready`, { body: {} });
        close();
        const noteSaid = r.note?.by === "journal" ? ` Claude couldn't write the handoff note (${r.note.why}), so it's the journal.` : "";
        toast(`v${r.version.n} is Ready for Development.${noteSaid}${r.pushed ? "" : " Not shared yet: " + (r.pushError ?? "no GitHub")}`, !r.pushed || !!noteSaid, 8000);
        await refresh();
      } catch (err) {
        status.textContent = err.message;
        send.disabled = false;
      }
    };
  }

  function drawAll() {
    drawBar();
    drawNote();
    drawStage();
  }

  async function refresh() {
    if (!(await load())) return;
    drawBar();
    drawNote();
    drawStage({ keep: true });
  }

  onEvent = (e) => {
    if (e.project && e.project !== id) return;
    if (e.type === "pictures") return void loadPictures();
    if (e.type === "app") return void api(`/api/projects/${enc}/app`).then((a) => ((state.d.app = a), state.canvas?.updatePictures())).catch(() => {});
    if (e.type === "publishing") return void ((state.publishing = e.done < e.total ? { done: e.done, total: e.total } : state.publishing), drawNote());
    if (e.type === "handoff") return;
    if (state.canvas?.editing() || bar.querySelector(".is-editing")) return void (state.later = true);
    refresh();
  };

  if (await load()) drawAll();
}

// ---------- routing ----------

function route() {
  const m = /^\/d\/([^/]+)$/.exec(location.pathname);
  document.onpointerdown = null;
  document.querySelectorAll(".fcanvas").forEach((c) => c.remove());
  if (m) design(decodeURIComponent(m[1]));
  else home();
}

window.addEventListener("popstate", route);
route();
