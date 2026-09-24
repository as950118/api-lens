import type { ImpactGraph } from "../analysis/graph.js";

export interface HtmlReportOptions {
  title: string;
  subtitle?: string;
}

/**
 * Self-contained interactive page (no external requests): layered
 * API → field → function/component → file graph with search, kind filters,
 * click-to-trace and a searchable list view.
 */
export function renderHtml(graph: ImpactGraph, options: HtmlReportOptions): string {
  // JSON inside <script>: "<" would allow "</script>" breakouts; U+2028/2029 break older JS parsers.
  const payload = JSON.stringify({ graph, title: options.title, subtitle: options.subtitle ?? "" })
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="title">
    <h1 id="title"></h1>
    <p id="subtitle"></p>
  </div>
  <div id="stats" class="stats"></div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search APIs, fields, functions, files…" autocomplete="off">
  <div id="kinds" class="kinds"></div>
  <div class="zoom">
    <button id="zoom-out" title="Zoom out">−</button>
    <button id="zoom-reset" title="Reset zoom">100%</button>
    <button id="zoom-in" title="Zoom in">+</button>
  </div>
</div>
<main>
  <section class="canvas" id="canvas"><svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg></section>
  <aside id="details" class="details"><p class="hint">Click a node to trace everything connected to it.</p></aside>
</main>
<section class="list">
  <h2>All nodes <span id="list-count"></span></h2>
  <table>
    <thead><tr><th>Kind</th><th>Name</th><th>Impact</th><th>Location</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</section>
<script id="graph-data" type="application/json">${payload}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLE = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e2e2de;
  --edge: #b9b9b3; --accent: #3b6fd8;
  --endpoint: #3b6fd8; --endpoint-bg: #eaf0fc; --field: #8a5cd8; --field-bg: #f3edfc;
  --function: #5f6b7a; --function-bg: #f0f2f5; --component: #2e9a62; --component-bg: #e7f5ee;
  --file: #7a7a74; --file-bg: #f5f5f2; --broken: #d33a3a; --broken-bg: #fdecec;
  --unresolved: #c98100; --unresolved-bg: #fff4df; --unused: #9a9a9a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416; --panel: #1c1c1f; --text: #ececef; --muted: #9a9aa2; --line: #2e2e33;
    --edge: #4a4a52; --accent: #7aa2f7;
    --endpoint: #7aa2f7; --endpoint-bg: #1d2638; --field: #b294f0; --field-bg: #272036;
    --function: #9aa5b4; --function-bg: #22252b; --component: #5cc98f; --component-bg: #17291f;
    --file: #a3a39c; --file-bg: #202021; --broken: #f07171; --broken-bg: #361b1b;
    --unresolved: #e6a73a; --unresolved-bg: #33270f; --unused: #6d6d72;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 ui-sans-serif, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between;
  padding: 20px 24px 12px; }
h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
header p { margin: 4px 0 0; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; min-width: 88px; }
.stat b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 12px; }
.stat.alert b { color: var(--broken); }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 0 24px 12px; }
#search { flex: 1 1 280px; max-width: 480px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); font: inherit; }
#search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.kinds { display: flex; flex-wrap: wrap; gap: 6px; }
.kinds label { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); cursor: pointer; user-select: none; font-size: 13px; }
.kinds input { accent-color: var(--accent); margin: 0; }
.swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.zoom { display: flex; gap: 4px; margin-left: auto; }
.zoom button { min-width: 34px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel);
  color: var(--text); font: inherit; cursor: pointer; }
main { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; padding: 0 24px; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; } }
.canvas { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: auto; height: 68vh; }
.details { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px;
  max-height: 68vh; overflow: auto; }
.details h3 { margin: 0 0 2px; font-size: 15px; word-break: break-all; }
.details .kind { text-transform: uppercase; font-size: 11px; letter-spacing: .06em; color: var(--muted); }
.details h4 { margin: 14px 0 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
.details ul { margin: 0; padding-left: 16px; }
.details li { word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.hint { color: var(--muted); margin: 0; }
svg text { fill: var(--text); font-size: 12.5px; }
svg .col-title { fill: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.node { cursor: pointer; }
.node rect.box { stroke-width: 1.2; }
.node .sub { fill: var(--muted); font-size: 11px; }
.node .badge-bg { fill: var(--bg); stroke: var(--line); }
.node .badge { font-size: 11px; font-variant-numeric: tabular-nums; }
.node.endpoint rect.box { fill: var(--endpoint-bg); stroke: var(--endpoint); }
.node.field rect.box { fill: var(--field-bg); stroke: var(--field); }
.node.function rect.box { fill: var(--function-bg); stroke: var(--function); }
.node.component rect.box { fill: var(--component-bg); stroke: var(--component); }
.node.file rect.box { fill: var(--file-bg); stroke: var(--file); stroke-dasharray: 3 2; }
.node.not-found rect.box, .node.method-mismatch rect.box { fill: var(--broken-bg); stroke: var(--broken); stroke-width: 1.8; }
.node.unresolved rect.box { fill: var(--unresolved-bg); stroke: var(--unresolved); }
.node.unused rect.box { stroke: var(--unused); stroke-dasharray: 4 3; }
.node.unused text { fill: var(--muted); }
.edge { fill: none; stroke: var(--edge); stroke-width: 1.3; }
.edge.reads { stroke-dasharray: 5 4; }
.dim { opacity: .14; }
.node.match rect.box { stroke: var(--accent); stroke-width: 2.4; }
.node.selected rect.box { stroke-width: 2.6; }
.edge.hot { stroke: var(--accent); stroke-width: 2; opacity: 1; }
.list { padding: 20px 24px 40px; }
.list h2 { font-size: 15px; margin: 0 0 8px; }
.list h2 span { color: var(--muted); font-weight: 400; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--bg); }
td { font-size: 13px; word-break: break-all; }
td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--bg); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--line); }
`;

// Plain JS (no template literals) so it can live inside this TypeScript template string.
const SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById("graph-data").textContent);
  var nodes = data.graph.nodes, edges = data.graph.edges;
  var byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
  var out = new Map(), inn = new Map();
  function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }
  edges.forEach(function (e) { push(out, e.from, e.to); push(inn, e.to, e.from); });

  var KIND_LABEL = { endpoint: "API", field: "Response field", function: "Function", component: "Component", file: "File" };
  var KIND_COLOR = { endpoint: "var(--endpoint)", field: "var(--field)", function: "var(--function)", component: "var(--component)", file: "var(--file)" };
  document.getElementById("title").textContent = data.title;
  document.getElementById("subtitle").textContent = data.subtitle;

  // ---- stats
  var count = function (k) { return nodes.filter(function (n) { return n.kind === k; }).length; };
  var broken = nodes.filter(function (n) { return n.status === "not-found" || n.status === "method-mismatch"; }).length;
  var stats = [["APIs", count("endpoint")], ["Fields", count("field")], ["Components", count("component")],
    ["Functions", count("function")], ["Files", count("file")]];
  if (broken) stats.push(["Broken APIs", broken, true]);
  var statsEl = document.getElementById("stats");
  stats.forEach(function (s) {
    var d = el("div", "stat" + (s[2] ? " alert" : ""));
    d.appendChild(el("b", null, String(s[1]))); d.appendChild(el("span", null, s[0])); statsEl.appendChild(d);
  });

  // ---- layered layout: endpoints | fields | functions (longest path) | files
  var rank = new Map();
  nodes.forEach(function (n) { rank.set(n.id, n.kind === "endpoint" ? 0 : n.kind === "field" ? 1 : 2); });
  for (var iter = 0; iter < 20; iter++) {
    var changed = false;
    edges.forEach(function (e) {
      var t = byId.get(e.to);
      if (!t || t.kind === "file" || t.kind === "field") return;
      var r = Math.max(2, rank.get(e.from) + 1);
      if (r > rank.get(e.to) && r < 10) { rank.set(e.to, r); changed = true; }
    });
    if (!changed) break;
  }
  var maxRank = 2;
  nodes.forEach(function (n) { if (n.kind !== "file") maxRank = Math.max(maxRank, rank.get(n.id)); });
  nodes.forEach(function (n) { if (n.kind === "file") rank.set(n.id, maxRank + 1); });
  var columns = [];
  nodes.forEach(function (n) { var r = rank.get(n.id); (columns[r] = columns[r] || []).push(n); });
  columns = columns.map(function (c) { return (c || []).sort(function (a, b) { return a.label.localeCompare(b.label); }); });
  var pos = new Map();
  function index() { columns.forEach(function (c) { c.forEach(function (n, i) { pos.set(n.id, i); }); }); }
  function bary(n, adj) {
    var ns = (adj.get(n.id) || []).filter(function (id) { return pos.has(id); });
    if (!ns.length) return pos.get(n.id);
    return ns.reduce(function (s, id) { return s + pos.get(id); }, 0) / ns.length;
  }
  index();
  for (var sweep = 0; sweep < 4; sweep++) {
    for (var r = 1; r < columns.length; r++) { columns[r].sort(function (a, b) { return bary(a, inn) - bary(b, inn); }); index(); }
    for (var r2 = columns.length - 2; r2 >= 0; r2--) { columns[r2].sort(function (a, b) { return bary(a, out) - bary(b, out); }); index(); }
  }

  var W = 236, H = 46, GX = 92, GY = 12, PADX = 24, PADY = 44;
  var tallest = Math.max.apply(null, columns.map(function (c) { return c.length; }).concat([1]));
  var width = PADX * 2 + columns.length * W + (columns.length - 1) * GX;
  var height = PADY + tallest * (H + GY) + 20;
  var xy = new Map();
  columns.forEach(function (c, r) {
    var offset = (tallest - c.length) * (H + GY) / 2;
    c.forEach(function (n, i) { xy.set(n.id, { x: PADX + r * (W + GX), y: PADY + offset + i * (H + GY) }); });
  });

  var svg = document.getElementById("graph");
  var NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  columns.forEach(function (c, r) {
    var title = r === 0 ? "API" : r === 1 ? "Response field" : r === columns.length - 1 ? "File" : "Function / Component";
    if (c.length) svg.appendChild(s("text", { x: PADX + r * (W + GX), y: 24, "class": "col-title" }, title));
  });
  var edgeEls = [];
  var edgeLayer = s("g", {}), nodeLayer = s("g", {});
  svg.appendChild(edgeLayer); svg.appendChild(nodeLayer);
  edges.forEach(function (e) {
    var a = xy.get(e.from), b = xy.get(e.to);
    if (!a || !b) return;
    var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    if (x2 <= x1) { x1 = a.x + W / 2; y1 = a.y + H; x2 = b.x + W / 2; y2 = b.y; }
    var mx = (x1 + x2) / 2;
    var d = x2 > x1 ? "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2
      : "M" + x1 + "," + y1 + " L" + x2 + "," + y2;
    var p = s("path", { d: d, "class": "edge " + e.kind });
    edgeLayer.appendChild(p);
    edgeEls.push({ el: p, e: e });
  });
  var nodeEls = new Map();
  nodes.forEach(function (n) {
    var p = xy.get(n.id);
    var g = s("g", { "class": "node " + n.kind + (n.status ? " " + n.status : ""), transform: "translate(" + p.x + "," + p.y + ")" });
    g.appendChild(s("rect", { "class": "box", width: W, height: H, rx: 7 }));
    g.appendChild(s("text", { x: 10, y: 19 }, clip(n.label, 30)));
    g.appendChild(s("text", { x: 10, y: 35, "class": "sub" }, clip(sub(n), 34)));
    var badge = impactText(n);
    if (badge) {
      var bw = 10 + badge.length * 6.4;
      g.appendChild(s("rect", { "class": "badge-bg", x: W - bw - 6, y: 6, width: bw, height: 17, rx: 8.5 }));
      g.appendChild(s("text", { "class": "badge", x: W - bw / 2 - 6, y: 18, "text-anchor": "middle" }, badge));
    }
    g.appendChild(s("title", {}, n.label + (n.detail ? "\\n" + n.detail : "")));
    g.addEventListener("click", function (ev) { ev.stopPropagation(); select(n.id); });
    nodeLayer.appendChild(g);
    nodeEls.set(n.id, g);
  });
  document.getElementById("canvas").addEventListener("click", function () { select(null); });

  var scale = 1;
  function applyZoom() {
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", width * scale); svg.setAttribute("height", height * scale);
    document.getElementById("zoom-reset").textContent = Math.round(scale * 100) + "%";
  }
  document.getElementById("zoom-in").onclick = function () { scale = Math.min(2.5, scale * 1.2); applyZoom(); };
  document.getElementById("zoom-out").onclick = function () { scale = Math.max(0.3, scale / 1.2); applyZoom(); };
  document.getElementById("zoom-reset").onclick = function () { scale = 1; applyZoom(); };
  applyZoom();

  function sub(n) {
    if (n.kind === "endpoint") return n.status === "unused" ? "no frontend usage" : n.status && n.status !== "matched" ? n.status.replace("-", " ") : (n.detail || "").split(".").pop();
    if (n.kind === "field") return n.detail || "";
    return n.detail || "";
  }
  function impactText(n) {
    if (!n.impact) return "";
    if (n.kind === "endpoint" || n.kind === "field") return n.impact + (n.impact > 1 ? " files" : " file");
    return n.impact + (n.impact > 1 ? " APIs" : " API");
  }
  function clip(t, max) { return t.length > max ? t.slice(0, max - 1) + "…" : t; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function reach(start, adj) {
    var seen = new Set([start]), q = [start];
    while (q.length) (adj.get(q.shift()) || []).forEach(function (id) { if (!seen.has(id)) { seen.add(id); q.push(id); } });
    return seen;
  }

  // ---- kind filters
  var hidden = new Set();
  var kindsEl = document.getElementById("kinds");
  ["endpoint", "field", "component", "function", "file"].forEach(function (k) {
    if (!count(k)) return;
    var label = el("label"); var cb = el("input"); cb.type = "checkbox"; cb.checked = true;
    var sw = el("span", "swatch"); sw.style.background = KIND_COLOR[k];
    label.appendChild(cb); label.appendChild(sw); label.appendChild(document.createTextNode(KIND_LABEL[k]));
    cb.onchange = function () { if (cb.checked) hidden.delete(k); else hidden.add(k); refresh(); };
    kindsEl.appendChild(label);
  });

  // ---- selection, search
  var selected = null, query = "";
  var search = document.getElementById("search");
  search.addEventListener("input", function () { query = search.value.trim().toLowerCase(); refresh(); renderRows(); });
  search.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var first = nodes.find(matches);
    if (first) { select(first.id); scrollTo(first.id); }
  });
  function matches(n) {
    return query !== "" && (n.label.toLowerCase().indexOf(query) >= 0 || (n.detail || "").toLowerCase().indexOf(query) >= 0);
  }
  function scrollTo(id) {
    var p = xy.get(id), c = document.getElementById("canvas");
    c.scrollTo({ left: Math.max(0, p.x * scale - 60), top: Math.max(0, p.y * scale - c.clientHeight / 2), behavior: "smooth" });
  }
  function select(id) { selected = id; refresh(); renderDetails(); }
  function refresh() {
    var focus = null;
    if (selected) { focus = reach(selected, out); reach(selected, inn).forEach(function (id) { focus.add(id); }); }
    nodes.forEach(function (n) {
      var g = nodeEls.get(n.id);
      g.style.display = hidden.has(n.kind) ? "none" : "";
      var dim = (focus && !focus.has(n.id)) || (!focus && query !== "" && !matches(n));
      g.classList.toggle("dim", !!dim);
      g.classList.toggle("match", matches(n));
      g.classList.toggle("selected", n.id === selected);
    });
    edgeEls.forEach(function (x) {
      var hide = hidden.has(byId.get(x.e.from).kind) || hidden.has(byId.get(x.e.to).kind);
      x.el.style.display = hide ? "none" : "";
      var hot = focus && focus.has(x.e.from) && focus.has(x.e.to);
      x.el.classList.toggle("hot", !!hot);
      x.el.classList.toggle("dim", !!(focus && !hot) || (!focus && query !== ""));
    });
  }
  function renderDetails() {
    var box = document.getElementById("details");
    box.textContent = "";
    if (!selected) { box.appendChild(el("p", "hint", "Click a node to trace everything connected to it.")); return; }
    var n = byId.get(selected);
    box.appendChild(el("div", "kind", KIND_LABEL[n.kind] + (n.status ? " · " + n.status : "")));
    box.appendChild(el("h3", null, n.label));
    if (n.detail) box.appendChild(el("div", "hint", n.detail));
    var impact = impactText(n);
    if (impact) box.appendChild(el("p", null, (n.kind === "endpoint" || n.kind === "field") ? "Changing this affects " + impact + "." : "Depends on " + impact + "."));
    var up = reach(n.id, inn), down = reach(n.id, out);
    section("APIs", [].concat(Array.from(up), Array.from(down)).filter(function (id) { return id !== n.id && byId.get(id).kind === "endpoint"; }));
    section("Response fields", Array.from(n.kind === "endpoint" ? down : up).filter(function (id) { return id !== n.id && byId.get(id).kind === "field"; }));
    section("Components", [].concat(Array.from(up), Array.from(down)).filter(function (id) { return id !== n.id && byId.get(id).kind === "component"; }));
    section("Files", Array.from(down).filter(function (id) { return id !== n.id && byId.get(id).kind === "file"; }));
    function section(title, ids) {
      ids = Array.from(new Set(ids));
      if (!ids.length) return;
      box.appendChild(el("h4", null, title + " (" + ids.length + ")"));
      var ul = el("ul");
      ids.map(function (id) { return byId.get(id).label; }).sort().forEach(function (l) { ul.appendChild(el("li", null, l)); });
      box.appendChild(ul);
    }
  }

  // ---- list view
  function renderRows() {
    var rows = document.getElementById("rows");
    rows.textContent = "";
    var list = nodes.filter(function (n) { return query === "" || matches(n); })
      .sort(function (a, b) { return rank.get(a.id) - rank.get(b.id) || b.impact - a.impact || a.label.localeCompare(b.label); });
    document.getElementById("list-count").textContent = "(" + list.length + ")";
    list.forEach(function (n) {
      var tr = el("tr");
      var kind = el("td"); var pill = el("span", "pill", KIND_LABEL[n.kind]); pill.style.color = KIND_COLOR[n.kind]; kind.appendChild(pill);
      tr.appendChild(kind);
      tr.appendChild(el("td", "mono", n.label + (n.status && n.status !== "matched" ? "  [" + n.status + "]" : "")));
      tr.appendChild(el("td", null, impactText(n) || "–"));
      tr.appendChild(el("td", "mono", n.file ? n.file + (n.line ? ":" + n.line : "") : (n.detail || "")));
      tr.onclick = function () { select(n.id); scrollTo(n.id); window.scrollTo({ top: 0, behavior: "smooth" }); };
      rows.appendChild(tr);
    });
  }
  refresh();
  renderRows();
})();
`;
