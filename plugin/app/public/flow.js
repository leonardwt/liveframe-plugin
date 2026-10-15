// A design's canvas: its screens as pictures on a canvas you pan and zoom (Z to fit), a row per idea.
// Click a screen to open its page in a new tab. Double-click a name to change it.
//
// Editing (your own design, the latest): drag on empty canvas to select screens (Shift adds); drag a
// screen to move it (a click without moving still opens it); Delete removes the selected screens or
// the selected arrow; hover a screen for four dots and drag from one onto another screen to connect
// them with an arrow. Pan with the trackpad, space + drag, or the middle button; zoom with ⌘/Ctrl +
// scroll or the buttons. Selecting, moving and deleting are per frame (with ideas, a page in one
// idea row); arrows are per page, drawn in every row that has both screens.

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
const SVG = "http://www.w3.org/2000/svg";

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
 * groups: [{ title, sub?, rows: [{ label?, cards: [{ page, key, title, rename?, note?, href }] }] }]
 *   page: the screen (the same page in every idea row); key: its picture (page, or page~idea)
 * viewport: { width, height } the pages are laid out at
 * pictures(card): a picture of the screen, or null while there's none yet
 * appStatus(): the design's app while it isn't running yet ({ label }), else null
 * camera: where to start ({ x, y, k }); fits the canvas when there's none
 * layout: { <key>: { x, y } } where frames were moved to (in their row); others sit in a row
 * links: [{ from, to }] arrows between screens (pages)
 * onOpen(card, event): a screen was clicked (not dragged). The screen is a link to card.href, so
 *   ⌘-click and middle-click work too; call event.preventDefault() to open it another way.
 * onRename(what, value), onEditEnd(): a name was changed / a change of name finished
 * edit: null (look only), or { onLayout(layout), onLinks(links), onDelete(keys), onUndo() }
 */
export function flowCanvas({ groups, viewport, pictures, appStatus, camera, layout = {}, links = [], onOpen, onRename, onEditEnd, edit = null }) {
  const stepW = viewport.width < 768 ? PHONE_W : DESKTOP_W;
  const stepH = Math.round(viewport.height * (stepW / viewport.width));
  const cardH = HEAD_H + stepH + NOTE_H;
  const root = el("div", `fcanvas${edit ? " fcanvas--edit" : ""}`);
  root.tabIndex = 0;
  root.setAttribute("aria-label", "Canvas");
  const world = el("div", "fworld");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "farrows");
  svg.setAttribute("width", "100000");
  svg.setAttribute("height", "100000");
  svg.innerHTML = '<defs><marker id="fhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b6b75"/></marker><marker id="fhead-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3d5bff"/></marker></defs>';
  world.append(svg);
  root.append(world);

  const at = (node, x, y) => ((node.style.transform = `translate(${x}px, ${y}px)`), world.append(node));
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

  // ---------- layout ----------

  const pos = { ...layout }; // frame (key) → { x, y } in its row (moving changes it)
  const cards = []; // { card, row, el, frame, x, y } in world coordinates
  const rowsAt = []; // { cards: [...], y } where each row's screens start
  let width = 0;
  let y = 0;
  for (const group of groups) {
    at(el("div", "flabel", el("strong", null, group.title), group.sub ? el("span", null, group.sub) : null), 0, y);
    y += LABEL_H;
    group.rows.forEach((row, r) => {
      if (r > 0) y += ROW_GAP;
      if (row.label) {
        at(el("div", "frowlabel", row.label), 0, y);
        y += ROW_LABEL_H;
      }
      const here = { cards: [], y };
      rowsAt.push(here);
      let bottom = 0;
      row.cards.forEach((card, i) => {
        const p = pos[card.key] ?? pos[card.page] ?? { x: i * (stepW + GAP), y: 0 };
        const frame = el("a", "fstep__frame");
        frame.style.height = `${stepH}px`;
        frame.href = card.href;
        frame.target = "_blank";
        frame.rel = "noopener";
        frame.draggable = false;
        frame.title = edit ? "Click to open in a new tab · drag to move" : "Open at real size in a new tab";
        const pic = el("img", "fstep__pic");
        pic.alt = "";
        pic.decoding = "async";
        const wait = el("div", "fstep__wait", el("span"), el("small"));
        frame.append(pic, wait);
        const title = named(el("span", "fstep__title", card.title), card.rename);
        const step = el("div", "fstep", el("div", "fstep__head", title), frame, named(el("div", "fstep__note", card.note || ""), card.renameNote, "Add a note"));
        step.style.width = `${stepW}px`;
        step.style.setProperty("--fh", `${stepH}px`);
        step.dataset.page = card.page;
        step.dataset.key = card.key;
        const c = { card, row: here, el: step, frame, pic, wait, x: p.x, y: here.y + p.y };
        if (edit) for (const side of ["top", "right", "bottom", "left"]) {
          const dot = el("span", `fhandle fhandle--${side}`);
          dot.dataset.side = side;
          dot.title = "Drag onto another screen to connect them";
          step.append(dot);
        }
        at(step, c.x, c.y);
        cards.push(c);
        here.cards.push(c);
        showPicture(c);
        frame.addEventListener("click", (e) => {
          if (moved) return e.preventDefault();
          onOpen?.(card, e);
        });
        // Shift-click a name: add it to the selection or take it out. A click: select it.
        title.addEventListener("click", (e) => {
          if (!edit) return;
          e.stopPropagation();
          select(e.shiftKey ? toggled(card.key) : new Set([card.key]));
        });
        width = Math.max(width, p.x + stepW);
        bottom = Math.max(bottom, p.y + cardH);
      });
      y += bottom;
    });
    y += GROUP_GAP;
  }
  const height = Math.max(0, y - GROUP_GAP);

  function showPicture(c) {
    const src = pictures?.(c.card) ?? null;
    const app = appStatus?.();
    c.wait.hidden = !!src;
    c.pic.hidden = !src;
    if (src && c.pic.getAttribute("src") !== src) c.pic.src = src;
    c.wait.firstChild.textContent = app ? `${app.label}…` : "Taking a picture…";
    c.wait.lastChild.textContent = app ? "The screen shows here once it's running" : "Click it to open the live page";
  }

  // ---------- arrows ----------

  const rectOf = (c) => ({ x: c.x, y: c.y + HEAD_H, w: stepW, h: stepH });
  /** A curve from one screen's nearest edge to the other's. */
  function curve(a, b) {
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    let p1, p2, d1, d2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = Math.sign(dx) || 1;
      p1 = { x: s > 0 ? a.x + a.w : a.x, y: ca.y };
      p2 = { x: s > 0 ? b.x : b.x + b.w, y: cb.y };
      d1 = { x: s, y: 0 };
      d2 = { x: -s, y: 0 };
    } else {
      const s = Math.sign(dy) || 1;
      p1 = { x: ca.x, y: s > 0 ? a.y + a.h : a.y };
      p2 = { x: cb.x, y: s > 0 ? b.y : b.y + b.h };
      d1 = { x: 0, y: s };
      d2 = { x: 0, y: -s };
    }
    const k = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3);
    return `M${p1.x} ${p1.y} C${p1.x + d1.x * k} ${p1.y + d1.y * k} ${p2.x + d2.x * (k + 6)} ${p2.y + d2.y * (k + 6)} ${p2.x + d2.x * 6} ${p2.y + d2.y * 6}`;
  }
  let selectedLink = null;
  function drawLinks() {
    svg.querySelectorAll("g.flink").forEach((g) => g.remove());
    links.forEach((l, i) => {
      for (const row of rowsAt) {
        const a = row.cards.find((c) => c.card.page === l.from);
        const b = row.cards.find((c) => c.card.page === l.to);
        if (!a || !b) continue;
        const d = curve(rectOf(a), rectOf(b));
        const g = document.createElementNS(SVG, "g");
        g.setAttribute("class", `flink${selectedLink === i ? " is-selected" : ""}`);
        const hit = document.createElementNS(SVG, "path");
        hit.setAttribute("class", "flink__hit");
        hit.setAttribute("d", d);
        const line = document.createElementNS(SVG, "path");
        line.setAttribute("class", "flink__line");
        line.setAttribute("d", d);
        line.setAttribute("marker-end", selectedLink === i ? "url(#fhead-on)" : "url(#fhead)");
        g.append(hit, line);
        if (edit) g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          selectedLink = i;
          select(new Set());
          drawLinks();
        });
        svg.append(g);
      }
    });
  }
  drawLinks();

  // ---------- selection ----------

  let selected = new Set();
  const toggled = (page) => {
    const s = new Set(selected);
    s.has(page) ? s.delete(page) : s.add(page);
    return s;
  };
  function select(set) {
    selected = set;
    if (set.size && selectedLink != null) (selectedLink = null), drawLinks();
    for (const c of cards) c.el.classList.toggle("is-selected", selected.has(c.card.key));
  }

  // ---------- camera ----------

  const cam = { x: 0, y: 0, k: 1, ...camera };
  let userMoved = !!camera;
  const pct = el("button", "zpill__pct", "100%");
  function apply() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    root.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    root.style.backgroundSize = `${24 * cam.k}px ${24 * cam.k}px`;
    root.style.setProperty("--inv", String(1 / cam.k));
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
  /** A point on the screen → the canvas's own coordinates. */
  const toWorld = (cx, cy) => {
    const r = root.getBoundingClientRect();
    return { x: (cx - r.left - cam.x) / cam.k, y: (cy - r.top - cam.y) / cam.k };
  };

  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else {
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
      userMoved = true;
      apply();
    }
  }, { passive: false });

  // ---------- pointer: pan, select, move, connect ----------

  let space = false;
  let drag = null; // { kind: "pan" | "box" | "move" | "link", … }
  let moved = false;
  const marquee = el("div", "fmarquee");
  marquee.hidden = true;
  root.append(marquee);
  const ghost = document.createElementNS(SVG, "path");
  ghost.setAttribute("class", "flink__ghost");
  ghost.setAttribute("marker-end", "url(#fhead-on)");

  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".zpill, .is-editing, .fstep__title")) return;
    // A drag on the canvas never selects the page's text (the browser would tint screens and labels).
    if (e.button === 0) e.preventDefault();
    root.focus({ preventScroll: true });
    moved = false;
    const start = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || (e.button === 0 && (space || !edit))) {
      // Space + drag, the middle button, or anywhere when you can only look: pan.
      drag = { kind: "pan", start, cx: cam.x, cy: cam.y };
      if (e.button === 1) e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const handle = e.target.closest(".fhandle");
    const step = e.target.closest(".fstep");
    if (handle && step) {
      e.preventDefault();
      const from = cards.find((c) => c.el === step);
      drag = { kind: "link", start, from };
      svg.append(ghost);
      return;
    }
    if (step) {
      const c = cards.find((x) => x.el === step);
      const key = c.card.key;
      const keys = selected.has(key) ? new Set(selected) : new Set([key]);
      drag = { kind: "move", start, key, keys, from: cards.filter((x) => keys.has(x.card.key)).map((x) => ({ c: x, x: x.x, y: x.y })) };
      return;
    }
    // Empty canvas: a selection box (Shift: add to what's selected).
    drag = { kind: "box", start, base: e.shiftKey ? new Set(selected) : new Set() };
    if (selectedLink != null) (selectedLink = null), drawLinks();
  });

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.start.x;
    const dy = e.clientY - drag.start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (drag.kind === "pan") {
      root.classList.add("is-panning");
      cam.x = drag.cx + dx;
      cam.y = drag.cy + dy;
      userMoved = true;
      apply();
    } else if (drag.kind === "box") {
      const r = root.getBoundingClientRect();
      const x1 = Math.min(e.clientX, drag.start.x) - r.left;
      const y1 = Math.min(e.clientY, drag.start.y) - r.top;
      Object.assign(marquee.style, { left: `${x1}px`, top: `${y1}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
      marquee.hidden = false;
      const a = toWorld(Math.min(e.clientX, drag.start.x), Math.min(e.clientY, drag.start.y));
      const b = toWorld(Math.max(e.clientX, drag.start.x), Math.max(e.clientY, drag.start.y));
      const hit = new Set(drag.base);
      for (const c of cards) {
        const rc = { x: c.x, y: c.y, w: stepW, h: cardH };
        if (rc.x < b.x && rc.x + rc.w > a.x && rc.y < b.y && rc.y + rc.h > a.y) hit.add(c.card.key);
      }
      select(hit);
    } else if (drag.kind === "move") {
      root.classList.add("is-moving");
      if (!selected.has(drag.key)) select(drag.keys);
      const mx = dx / cam.k;
      const my = dy / cam.k;
      for (const { c, x, y } of drag.from) {
        c.x = x + mx;
        c.y = y + my;
        c.el.style.transform = `translate(${c.x}px, ${c.y}px)`;
      }
      drawLinks();
    } else if (drag.kind === "link") {
      root.classList.add("is-linking");
      const p = toWorld(e.clientX, e.clientY);
      const a = rectOf(drag.from);
      ghost.setAttribute("d", curve(a, { x: p.x, y: p.y, w: 0, h: 0 }));
      const over = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains("fstep"));
      cards.forEach((c) => c.el.classList.toggle("is-target", c.el === over && c.card.page !== drag.from.card.page));
    }
  }
  function onUp(e) {
    const d = drag;
    drag = null;
    root.classList.remove("is-panning", "is-moving", "is-linking");
    marquee.hidden = true;
    ghost.remove();
    cards.forEach((c) => c.el.classList.remove("is-target"));
    if (d && moved && edit) {
      if (d.kind === "move") {
        // Every frame keeps where it is now (a frame never moved before gets its row place written down).
        const next = {};
        for (const c of cards) next[c.card.key] = { x: Math.round(c.x), y: Math.round(c.y - c.row.y) };
        edit.onLayout(next);
      } else if (d.kind === "link") {
        const over = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains("fstep"));
        const to = over && cards.find((c) => c.el === over)?.card.page;
        const from = d.from.card.page;
        if (to && to !== from && !links.some((l) => l.from === from && l.to === to)) edit.onLinks([...links, { from, to }]);
      }
    } else if (d && !moved && d.kind === "box") {
      select(new Set()); // a click on empty canvas clears the selection
    }
    setTimeout(() => (moved = false), 0);
  }

  // ---------- keys ----------

  function onKey(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || document.querySelector(".modal-back")) return;
    if (e.key === " " && !e.repeat) {
      space = true;
      root.classList.add("is-space");
      if (root.contains(document.activeElement) || document.activeElement === document.body) e.preventDefault();
      return;
    }
    if (edit && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) return void (e.preventDefault(), edit.onUndo?.());
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (edit && (e.key === "Delete" || e.key === "Backspace")) {
      if (selectedLink != null) {
        e.preventDefault();
        const l = links[selectedLink];
        selectedLink = null;
        edit.onLinks(links.filter((x) => x !== l));
      } else if (selected.size) {
        e.preventDefault();
        edit.onDelete([...selected]);
      }
      return;
    }
    if (e.key === "Escape") return void (select(new Set()), selectedLink != null && ((selectedLink = null), drawLinks()));
    if (e.key === "z" || e.key === "Z") fit();
    else if (e.key === "+" || e.key === "=") zoomAt(...center(), 1.25);
    else if (e.key === "-") zoomAt(...center(), 0.8);
    else return;
    e.preventDefault();
  }
  const onKeyUp = (e) => e.key === " " && ((space = false), root.classList.remove("is-space"));
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

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
  if (camera) apply();
  else requestAnimationFrame(fit);

  return {
    el: root,
    /** Where you are (a redraw keeps it, so editing never moves the view). */
    camera: () => ({ x: cam.x, y: cam.y, k: cam.k }),
    /** Is a name being changed? (Don't redraw under it.) */
    editing: () => editing > 0,
    /** New pictures, or the app's status changed: show them. */
    updatePictures: () => cards.forEach(showPicture),
    destroy() {
      ro.disconnect();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    },
  };
}
