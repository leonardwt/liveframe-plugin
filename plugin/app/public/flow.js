// A design's canvas: every page of the design as a screen (the live page scaled down) on a canvas
// you pan and zoom (Z to fit). Groups of rows: a flow is a row of steps with arrows between, one row
// per idea; ideas on a page sit side by side. Click a screen to open it at real size in a new tab.
// Double-click a name or a note to change it. Scroll over a long page's screen to scroll the page in
// it. Pins: where a screen uses the colours it's asked to find.
// With pictures (designs in the real frontend), each screen is a picture of its page and nothing on
// the canvas runs the app: it opens at once. Clicking a screen opens the live page in a new tab;
// refreshing shows the latest pictures (new ones also swap in when they're taken).

const DESKTOP_W = 360; // how wide a screen is on the canvas
const PHONE_W = 220;
const GAP = 72;
const ROW_GAP = 40;
const GROUP_GAP = 96;
const LABEL_H = 34;
const ROW_LABEL_H = 26;
const HEAD_H = 37; // the name above a screen, and the space under it
const NOTE_H = 48;
const MIN_K = 0.1;
const MAX_K = 3;

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

/**
 * A text you change in place: double-click, type, Enter (Esc puts it back, so does clicking away
 * with nothing typed). onSave(value) returns a promise; if it fails the text goes back.
 * empty: what an empty text says while you hover it (and then it may be left empty).
 */
export function editable(node, { onSave, empty, tip = "Double-click to rename", onStart, onEnd }) {
  node.classList.add("fedit");
  node.title = tip;
  if (empty) node.dataset.empty = empty;
  node.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.isContentEditable) return;
    const before = node.textContent;
    let done = false;
    onStart?.();
    node.contentEditable = "plaintext-only";
    node.classList.add("is-editing");
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const finish = async (save) => {
      if (done) return;
      done = true;
      node.removeEventListener("keydown", onKey);
      node.removeEventListener("blur", onBlur);
      node.contentEditable = "false";
      node.classList.remove("is-editing");
      getSelection().removeAllRanges();
      const value = node.textContent.replace(/\s+/g, " ").trim();
      if (!save || value === before.trim() || (!value && !empty)) {
        node.textContent = before;
        return onEnd?.();
      }
      node.textContent = value;
      try {
        await onSave(value);
      } catch {
        node.textContent = before;
      }
      onEnd?.();
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") e.preventDefault(), finish(true);
      else if (e.key === "Escape") e.preventDefault(), finish(false);
    };
    const onBlur = () => finish(true);
    node.addEventListener("keydown", onKey);
    node.addEventListener("blur", onBlur);
  });
  return node;
}

/**
 * groups: [{ title, rename?, sub?, rows: [{ label?, rename?, arrows?, cards: [{ title, rename?, note?, renameNote?, thumb, href, find? }] }] }]
 *   thumb: the page's address for the canvas; href: its address at real size
 *   find: colours to pin on this screen (the thumb asks the page for them with ?find=…, and the page
 *     answers with where they are)
 *   rename / renameNote: what onRename gets when that name or note is changed (none: it can't be)
 * viewport: { width, height } the pages are laid out at
 * onOpen(card, event): a screen was clicked (not dragged). The screen is a link to card.href, so
 *   ⌘-click and middle-click work too; call event.preventDefault() to open it another way.
 * camera: where to start ({ x, y, k }); fits the canvas when there's none
 * onRename(what, value): a name or note was changed; returns a promise
 * onEditEnd(): a change of name finished (saved or not)
 * onFound(card, items): a screen said where its colours are ([{ value, pins, gone }])
 * pictures(card): the address of a picture of the screen, or null while there's none yet. Given: every
 *   screen is its picture (no page runs on the canvas).
 * appStatus(): the design's app while it isn't running yet ({ label }), else null (with pictures)
 */
export function flowCanvas({ groups, viewport, onOpen, camera, onRename, onEditEnd, onFound, pictures, appStatus }) {
  const stepW = viewport.width < 768 ? PHONE_W : DESKTOP_W;
  const scale = stepW / viewport.width;
  const stepH = Math.round(viewport.height * scale);
  const root = el("div", "fcanvas");
  root.tabIndex = 0;
  root.setAttribute("aria-label", "Canvas");
  const world = el("div", "fworld");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "farrows");
  svg.innerHTML = '<defs><marker id="fhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#5d5d66"/></marker></defs>';
  world.append(svg);
  root.append(world);

  const at = (node, x, y) => ((node.style.transform = `translate(${x}px, ${y}px)`), world.append(node));
  const frames = [];
  // A screen's frame → { card, x, y, bar, pins, scroll: { top, max, view } }
  const screens = new Map();
  let editing = 0;
  const named = (node, what, empty) => {
    if (!what || !onRename) return node;
    return editable(node, {
      empty,
      tip: empty ? "Double-click to edit" : "Double-click to rename",
      onSave: (value) => onRename(what, value),
      onStart: () => editing++,
      onEnd: () => (editing--, onEditEnd?.()),
    });
  };

  // Layout: groups top to bottom, each a heading and its rows, screens left to right.
  let width = 0;
  let y = 0;
  for (const group of groups) {
    at(el("div", "flabel", named(el("strong", null, group.title), group.rename), group.sub ? el("span", null, group.sub) : null), 0, y);
    y += LABEL_H;
    group.rows.forEach((row, r) => {
      if (r > 0) y += ROW_GAP;
      if (row.label) {
        at(named(el("div", "frowlabel", row.label), row.rename), 0, y);
        y += ROW_LABEL_H;
      }
      row.cards.forEach((card, i) => {
        const x = i * (stepW + GAP);
        // The screen is the link; its name and note around it are for renaming, not opening.
        const frameBox = el("a", "fstep__frame");
        frameBox.style.height = `${stepH}px`;
        const frame = document.createElement("iframe");
        frame.dataset.src = card.thumb; // loaded once the camera is in place (see below)
        frame.loading = "lazy";
        frame.tabIndex = -1;
        frame.title = card.title;
        frame.style.width = `${viewport.width}px`;
        frame.style.height = `${viewport.height}px`;
        frame.style.transform = `scale(${scale})`;
        // A long page's scrollbar: shows where you are in it while you hover the screen.
        const bar = el("span", "fstep__scroll");
        bar.hidden = true;
        frameBox.append(frame, bar);
        frames.push(frame);
        const s = { card, x, y: y + HEAD_H, bar, scroll: null, origin: new URL(card.thumb, location.href).origin, box: frameBox };
        screens.set(frame, s);
        if (pictures) {
          s.pic = el("img", "fstep__pic");
          s.pic.alt = "";
          s.pic.decoding = "async";
          s.wait = el("div", "fstep__wait", el("span"), el("small"));
          frameBox.prepend(s.pic, s.wait);
          showPicture(s);
        }
        frameBox.href = card.href;
        frameBox.target = "_blank";
        frameBox.rel = "noopener";
        frameBox.draggable = false;
        frameBox.title = "Open at real size in a new tab";
        frameBox.addEventListener("click", (e) => {
          if (moved) return e.preventDefault();
          onOpen?.(card, e);
        });
        const step = el("div", "fstep",
          el("div", "fstep__head", named(el("span", "fstep__title", card.title), card.rename)),
          frameBox,
          named(el("div", "fstep__note", card.note || ""), card.renameNote, "Add a note"));
        step.style.width = `${stepW}px`;
        at(step, x, y);
        if (i > 0 && row.arrows) {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const ay = y + HEAD_H + stepH / 2;
          line.setAttribute("d", `M${x - GAP + 8} ${ay} L${x - 8} ${ay}`);
          line.setAttribute("marker-end", "url(#fhead)");
          svg.append(line);
        }
        width = Math.max(width, x + stepW);
      });
      y += HEAD_H + stepH + NOTE_H;
    });
    y += GROUP_GAP;
  }
  const height = Math.max(0, y - GROUP_GAP);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  // Pictures: each screen shows its picture; while there's none yet, what's happening.
  function showPicture(s) {
    const src = pictures(s.card);
    const app = appStatus?.();
    s.wait.hidden = !!src;
    s.pic.hidden = !src;
    if (src && s.pic.getAttribute("src") !== src) s.pic.src = src;
    s.wait.firstChild.textContent = app ? `${app.label}…` : "Taking a picture…";
    s.wait.lastChild.textContent = app ? "The screen shows here once it's running" : "Click it to open the live page";
  }

  // What the pages on the screens say: how far they scroll, and where their colours are.
  function onMessage(e) {
    const frame = frames.find((f) => f.contentWindow === e.source);
    const s = screens.get(frame);
    if (!s || e.data?.liveframe !== true) return;
    if (e.data.type === "scroll") return scrolled(frame, s, e.data);
    if (e.data.type === "found" && Array.isArray(e.data.items)) pinsFor(s, e.data.items);
  }
  window.addEventListener("message", onMessage);

  // Scrolling inside a screen. A page reloaded by a save goes back to where you were in it.
  function scrolled(frame, s, { top, max, view }) {
    top = Number(top) || 0;
    max = Math.max(0, Number(max) || 0);
    if (s.reloaded && s.scroll?.top > 0 && top === 0) {
      s.reloaded = false;
      return frame.contentWindow.postMessage({ liveframe: true, type: "scrollTo", top: s.scroll.top }, s.origin);
    }
    s.reloaded = false;
    s.scroll = { top, max, view: Math.min(1, Number(view) || 1) };
    drawBar(s);
  }
  function drawBar(s) {
    const { top, max, view } = s.scroll ?? {};
    s.bar.hidden = !(max > 0);
    if (!(max > 0)) return;
    const h = Math.max(16, stepH * view);
    s.bar.style.height = `${h}px`;
    s.bar.style.transform = `translateY(${((stepH - h) * top) / max}px)`;
  }
  /** Can the page on a screen scroll that way? dy: pixels on screen. */
  function canScroll(frame, dy) {
    const sc = screens.get(frame)?.scroll;
    return !!sc && sc.max > 0 && ((dy > 0 && sc.top < sc.max - 0.5) || (dy < 0 && sc.top > 0.5));
  }
  /** Scroll the page on a screen (stops at its end). dy: pixels on screen. */
  function scrollScreen(frame, dy) {
    const s = screens.get(frame);
    const sc = s.scroll;
    const by = dy / (scale * cam.k); // in the page's pixels, so the page moves with the pointer
    if (!canScroll(frame, dy)) return;
    sc.top = Math.min(sc.max, Math.max(0, sc.top + by));
    drawBar(s);
    frame.contentWindow.postMessage({ liveframe: true, type: "scrollBy", dy: by }, s.origin);
  }

  // Pins: the page says where each colour is in the part of it the screen shows (and again when it
  // scrolls). Above or below that: pinned on the screen's top or bottom edge. A colour on nothing
  // the screen shows gets no pin (onFound tells whoever asked).
  function pinsFor(s, items) {
    onFound?.(s.card, items);
    s.pins?.remove();
    s.pins = el("div", "fpins");
    const wanted = new Set(s.card.find);
    for (const item of items) {
      if (!wanted.has(item.value)) continue;
      const pin = (x, y, tip, area) => {
        const p = el("span", "fpin tip-up");
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.setProperty("--c", item.value);
        p.tabIndex = 0;
        p.dataset.tip = tip;
        p.setAttribute("aria-label", tip);
        if (area) {
          const box = el("span", "fpin__area");
          Object.assign(box.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.w}px`, height: `${area.h}px` });
          s.pins.append(box);
          p.addEventListener("pointerenter", () => box.classList.add("is-on"));
          p.addEventListener("pointerleave", () => box.classList.remove("is-on"));
        }
        s.pins.append(p);
      };
      if (item.gone || !item.pins?.length) continue;
      const edges = { above: [], below: [] }; // out of view: one pin per edge
      for (const f of item.pins) {
        const ax = Math.max(0, f.x * scale);
        const ay = f.y * scale;
        const what = [f.name, f.how].filter(Boolean).join(", ");
        if (ay > stepH - 4) edges.below.push({ ax, what });
        else if (ay + f.h * scale < 4) edges.above.push({ ax, what });
        else pin(Math.min(ax, stepW - 10), Math.max(ay, 0), `${item.value}${what ? ` · ${what}` : ""}`, { x: ax, y: Math.max(0, ay), w: Math.min(f.w * scale, stepW - ax), h: Math.min(ay + f.h * scale, stepH) - Math.max(0, ay) });
      }
      for (const [edge, list] of Object.entries(edges)) {
        if (!list.length) continue;
        const names = [...new Set(list.map((l) => l.what).filter(Boolean))].join("; ");
        const tip = `${item.value}${names ? ` · ${names}` : ""} · ${list.length > 1 ? `${list.length} ` : ""}further ${edge === "below" ? "down" : "up"} the page`;
        pin(Math.min(list[0].ax, stepW - 10), edge === "below" ? stepH : 0, tip);
      }
      if (item.more) s.pins.lastChild.dataset.tip += ` (and ${item.more} more)`;
    }
    at(s.pins, s.x, s.y);
  }

  // Camera.
  const cam = { x: 0, y: 0, k: 1, ...camera };
  let userMoved = !!camera;
  const pct = el("button", "zpill__pct", "100%");
  function apply() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    root.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    root.style.backgroundSize = `${24 * cam.k}px ${24 * cam.k}px`;
    root.style.setProperty("--inv", String(1 / cam.k)); // pins stay the same size at any zoom
    pct.textContent = `${Math.round(cam.k * 100)}%`;
  }
  function fit() {
    const r = root.getBoundingClientRect();
    if (!r.width || !width) return;
    const pad = 56;
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((r.width - pad * 2) / width, (r.height - pad * 2) / height, 1)));
    cam.k = k;
    cam.x = (r.width - width * k) / 2;
    cam.y = Math.max(pad, (r.height - height * k) / 2);
    userMoved = false;
    apply();
  }
  function zoomAt(px, py, factor) {
    const k = Math.min(MAX_K, Math.max(MIN_K, cam.k * factor));
    cam.x = px - ((px - cam.x) * k) / cam.k;
    cam.y = py - ((py - cam.y) * k) / cam.k;
    cam.k = k;
    userMoved = true;
    apply();
  }
  const center = () => {
    const r = root.getBoundingClientRect();
    return [r.width / 2, r.height / 2];
  };

  // A scroll gesture goes where it started: over a long page's screen that can scroll that way it
  // scrolls the page (and stops at its end), otherwise it pans the canvas, until the wheel rests.
  let gesture = null;
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const now = performance.now();
    const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
    if (!gesture || now - gesture.at > 160) {
      const frame = e.target.closest?.(".fstep__frame")?.querySelector("iframe");
      gesture = { frame: frame && vertical && !e.ctrlKey && !e.metaKey && canScroll(frame, e.deltaY) ? frame : null };
    }
    gesture.at = now;
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else if (gesture.frame) vertical && scrollScreen(gesture.frame, e.deltaY);
    else {
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
      userMoved = true;
      apply();
    }
  }, { passive: false });

  // Drag anywhere to pan; a drag never opens a screen.
  let drag = null;
  let moved = false;
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".zpill, .is-editing")) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    moved = false;
  });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    root.classList.add("is-dragging");
    cam.x = drag.cx + dx;
    cam.y = drag.cy + dy;
    userMoved = true;
    apply();
  }
  function onUp() {
    drag = null;
    root.classList.remove("is-dragging");
    setTimeout(() => (moved = false), 0);
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || document.querySelector(".modal-back")) return;
    if (e.key === "z" || e.key === "Z") fit();
    else if (e.key === "+" || e.key === "=") zoomAt(...center(), 1.25);
    else if (e.key === "-") zoomAt(...center(), 0.8);
    else return;
    e.preventDefault();
  }
  document.addEventListener("keydown", onKey);

  const btn = (label, tip, onclick) => {
    const b = el("button", "zpill__btn", label);
    b.type = "button";
    b.setAttribute("aria-label", tip);
    b.dataset.tip = tip;
    b.classList.add("tip-up");
    b.onclick = onclick;
    return b;
  };
  pct.type = "button";
  pct.dataset.tip = "Fit (Z)";
  pct.classList.add("tip-up");
  pct.onclick = fit;
  root.append(el("div", "zpill", btn("−", "Zoom out", () => zoomAt(...center(), 0.8)), pct, btn("+", "Zoom in", () => zoomAt(...center(), 1.25))));

  const ro = new ResizeObserver(() => !userMoved && fit());
  ro.observe(root);
  // Load the screens only once the camera is in place: a page that loads far off screen may
  // never paint once you pan to it.
  const loadFrames = () => !pictures && frames.forEach((f) => !f.src && (f.src = f.dataset.src));
  if (camera) apply(), requestAnimationFrame(loadFrames);
  else requestAnimationFrame(() => (fit(), requestAnimationFrame(loadFrames)));

  return {
    el: root,
    /** Where you are, if you've moved; null while it's fitted. */
    camera: () => (userMoved ? { x: cam.x, y: cam.y, k: cam.k } : null),
    /** Is a name being changed? (Don't redraw under it.) */
    editing: () => editing > 0,
    reload: () => !pictures && frames.forEach((f) => ((screens.get(f).reloaded = true), (f.src = f.dataset.src))),
    /** New pictures, or the app's status changed: show them. */
    updatePictures: () => pictures && [...screens.values()].forEach(showPicture),
    destroy() {
      ro.disconnect();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    },
  };
}
