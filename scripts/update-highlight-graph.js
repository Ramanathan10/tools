const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputFile = path.join(repoRoot, "now-reading", "highlight-graph.html");
const readwiseCli =
  process.env.READWISE_CLI || "C:\\Users\\trojanmini\\AppData\\Roaming\\npm\\readwise.ps1";
const highlightFields =
  "text,note,url,book_id,book_title,book_author,book_category,highlighted_at,tags";

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runReadwise(args) {
  const command = `& ${psQuote(readwiseCli)} ${args
    .map((arg) => (/[,\s]/.test(arg) ? psQuote(arg) : arg))
    .join(" ")}`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 30 }
  );
  if (result.status !== 0) {
    throw new Error(`Readwise command failed: ${command}\n${result.stderr || result.stdout}`);
  }
  const raw = (result.stdout || "").trim();
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`No JSON returned: ${command}`);
  return JSON.parse(raw.slice(start));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

const stopwords = new Set(
  "about after again against all also and any are because been before being between both but can code could did does doing done each every few for from get has have how into its just like make many more most much need not now often only other over own people same should some such than that the their them then there these they thing this those through time use using very want what when where which while with work your".split(
    " "
  )
);

function words(text) {
  return [...String(text || "").toLowerCase().matchAll(/[a-z][a-z0-9-]{3,}/g)]
    .map((match) => match[0])
    .filter((word) => !stopwords.has(word) && !/^\d+$/.test(word));
}

function keywords(text, limit = 8) {
  const counts = new Map();
  for (const word of words(text)) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function snippet(text, length = 170) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
}

function fetchHighlights() {
  const pages = [1, 2].map((page) =>
    runReadwise([
      "readwise-list-highlights",
      "--page-size",
      "100",
      "--page",
      String(page),
      "--response-fields",
      highlightFields,
      "--json",
    ])
  );
  const seen = new Set();
  return pages
    .flatMap((page) => page.results || [])
    .filter((item) => item.text && !seen.has(item.id) && seen.add(item.id))
    .map((item) => ({
      id: String(item.id),
      text: item.text,
      note: item.note || "",
      bookId: String(item.book_id || "unknown"),
      title: item.book_title || "Unknown Source",
      author: item.book_author || "Unknown",
      category: item.book_category || "unknown",
      url: item.url || "",
      highlightedAt: item.highlighted_at || "",
      keywords: keywords(`${item.text} ${item.note || ""}`),
    }));
}

function buildGraph(highlights) {
  const sources = new Map();
  for (const highlight of highlights) {
    if (!sources.has(highlight.bookId)) {
      sources.set(highlight.bookId, {
        id: `source:${highlight.bookId}`,
        type: "source",
        label: highlight.title,
        author: highlight.author,
        category: highlight.category,
        val: 8,
      });
    }
  }

  const nodes = [
    ...sources.values(),
    ...highlights.map((highlight) => ({
      id: highlight.id,
      type: "highlight",
      label: snippet(highlight.text, 90),
      title: highlight.title,
      author: highlight.author,
      category: highlight.category,
      url: highlight.url,
      text: highlight.text,
      note: highlight.note,
      keywords: highlight.keywords,
      val: 2.5,
    })),
  ];

  const links = highlights.map((highlight) => ({
    source: `source:${highlight.bookId}`,
    target: highlight.id,
    type: "source",
    label: "source",
    value: 1,
  }));

  const candidates = [];
  for (let a = 0; a < highlights.length; a += 1) {
    for (let b = a + 1; b < highlights.length; b += 1) {
      const first = highlights[a];
      const second = highlights[b];
      if (first.bookId === second.bookId) continue;
      const shared = first.keywords.filter((word) => second.keywords.includes(word));
      if (shared.length === 0) continue;
      candidates.push({
        source: first.id,
        target: second.id,
        type: "idea",
        label: shared.slice(0, 3).join(", "),
        value: shared.length,
      });
    }
  }

  links.push(
    ...candidates
      .sort((a, b) => b.value - a.value)
      .slice(0, 36)
      .map((candidate) => ({ ...candidate, value: Math.min(candidate.value, 4) }))
  );

  return { nodes, links };
}

function renderHtml(highlights, graph) {
  const sourceCount = new Set(highlights.map((highlight) => highlight.bookId)).size;
  const ideaCount = graph.links.filter((link) => link.type === "idea").length;
  const data = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Highlight Graph</title>
<script src="https://unpkg.com/force-graph"></script>
<style>
:root{--bg:#111014;--panel:#1b1820;--line:#393240;--text:#f4edf7;--muted:#b9abbf;--accent:#c4a7e7;--source:#f6c177;--idea:#eb6f92}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,sans-serif;overflow:hidden}.shell{display:grid;grid-template-columns:minmax(0,1fr) 320px;height:100vh}.graph{min-width:0}.panel{border-left:1px solid var(--line);background:rgba(27,24,32,.96);padding:18px;overflow:auto}h1{margin:0 0 8px;font-size:22px;letter-spacing:0}.meta{color:var(--muted);font-size:13px;margin-bottom:18px}.hint{color:var(--muted);font-size:13px;line-height:1.45}.item{padding:12px 0;border-top:1px solid var(--line)}.item strong{display:block;margin-bottom:5px}.item p{margin:0;color:var(--muted);font-size:13px;line-height:1.4}.pill{display:inline-block;margin:0 6px 6px 0;border:1px solid var(--line);border-radius:999px;padding:4px 8px;color:var(--muted);font-size:12px}@media(max-width:760px){.shell{grid-template-columns:1fr}.panel{position:absolute;right:0;bottom:0;left:0;max-height:42vh;border-left:0;border-top:1px solid var(--line)}}canvas{display:block}
</style>
</head>
<body>
<div class="shell">
  <div id="graph" class="graph"></div>
  <aside class="panel">
    <h1>Highlight Graph</h1>
    <div class="meta">${highlights.length} highlights · ${sourceCount} sources · ${ideaCount} idea links</div>
    <div id="details" class="hint">Click a source or highlight to inspect it. Orange nodes are sources; purple nodes are individual highlights; pink links connect repeated ideas across sources.</div>
  </aside>
</div>
<script>
const data=${data};
const details=document.getElementById('details');
const graph=ForceGraph()(document.getElementById('graph'))
  .graphData(data)
  .backgroundColor('#111014')
  .nodeRelSize(5)
  .nodeVal(node=>node.val)
  .nodeLabel(node=>node.type==='source'?node.label:node.text)
  .nodeColor(node=>node.type==='source'?'#f6c177':'#c4a7e7')
  .linkColor(link=>link.type==='idea'?'rgba(235,111,146,.68)':'rgba(196,167,231,.18)')
  .linkWidth(link=>link.type==='idea'?Math.max(1,link.value):.7)
  .linkDirectionalParticles(link=>link.type==='idea'?2:0)
  .linkDirectionalParticleSpeed(.004)
  .onNodeClick(node=>{
    if(node.type==='source'){
      const children=data.nodes.filter(candidate=>candidate.type==='highlight'&&candidate.title===node.label);
      details.innerHTML='<div class="item"><strong>'+escapeHtml(node.label)+'</strong><p>'+escapeHtml(node.author||'Unknown')+' · '+children.length+' highlights</p></div>'+children.slice(0,8).map(renderHighlight).join('');
      graph.centerAt(node.x,node.y,700); graph.zoom(3,700); return;
    }
    details.innerHTML=renderHighlight(node,true);
    graph.centerAt(node.x,node.y,700); graph.zoom(5,700);
  });

function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function renderHighlight(node,full=false){
  const text=full?node.text:(node.text||'').slice(0,220);
  const tags=(node.keywords||[]).slice(0,6).map(tag=>'<span class="pill">'+escapeHtml(tag)+'</span>').join('');
  return '<div class="item"><strong>'+escapeHtml(node.title||'Highlight')+'</strong><p>'+escapeHtml(node.author||'Unknown')+'</p><p>'+escapeHtml(text)+'</p><div>'+tags+'</div></div>';
}
window.addEventListener('resize',()=>graph.width(document.getElementById('graph').clientWidth).height(document.getElementById('graph').clientHeight));
</script>
</body>
</html>
`;
}

function main() {
  const highlights = fetchHighlights();
  const graph = buildGraph(highlights);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, renderHtml(highlights, graph), "utf8");
  console.log(
    JSON.stringify(
      {
        highlights: highlights.length,
        sources: new Set(highlights.map((highlight) => highlight.bookId)).size,
        ideaLinks: graph.links.filter((link) => link.type === "idea").length,
        outputFile,
      },
      null,
      2
    )
  );
}

main();
