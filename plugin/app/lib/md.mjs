// Just enough Markdown for journals and handoff notes: headings, lists, paragraphs, **bold**,
// `code`, code blocks and links. Everything is escaped first.

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function markdown(src) {
  const out = [];
  let list = null;
  let para = [];
  let code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`), (para = []);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`), (list = null);
  };
  for (const line of String(src ?? "").split("\n")) {
    if (code) {
      if (/^```/.test(line)) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`), (code = null);
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flush();
      code = [];
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) flush(), out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    else if (li || ol) {
      para.length && flush();
      const tag = li ? "ul" : "ol";
      if (list && list.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push((li ?? ol)[1]);
    } else if (!line.trim()) flush();
    else if (list && /^\s{2,}/.test(line)) list.items[list.items.length - 1] += " " + line.trim();
    else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}
