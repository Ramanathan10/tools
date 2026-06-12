const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "now-reading");
const outputFile = path.join(outputDir, "index.html");
const readwiseCli =
  process.env.READWISE_CLI || "C:\\Users\\trojanmini\\AppData\\Roaming\\npm\\readwise.ps1";

const activeFields =
  "title,author,category,reading_progress,first_opened_at,last_opened_at,image_url,url,site_name,word_count,saved_at";
const archiveFields =
  "title,author,category,reading_progress,last_opened_at,image_url,url,site_name,saved_at,word_count";

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
  if (start < 0) {
    throw new Error(`Readwise command returned no JSON: ${command}\n${raw.slice(0, 500)}`);
  }

  return JSON.parse(raw.slice(start));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function cleanImage(value) {
  if (!value) return "";
  const text = String(value).trim();
  return /^https?:\/\//i.test(text) ? text : "";
}

function stableHue(title) {
  let hue = 0;
  for (const ch of String(title || "Untitled")) {
    hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  }
  return hue;
}

function lastOpenedTime(item) {
  return parseDate(item.last_opened_at)?.getTime() || 0;
}

function itemKey(item) {
  return item.id || `${item.title}|${item.author}|${item.url}`;
}

function formatDay(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatMonth(date) {
  return date
    .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

function categoryLabel(category) {
  const normalized = String(category || "article").toLowerCase();
  return normalized === "epub" ? "book" : normalized;
}

function categoryEmoji(category) {
  return (
    {
      article: "📄",
      book: "📚",
      epub: "📚",
      tweet: "🐦",
      rss: "📰",
      email: "✉️",
      video: "🎬",
      podcast: "🎙",
      pdf: "📑",
      audiobook: "🎙",
    }[category] || "📄"
  );
}

function fetchArchivePages() {
  const pages = [];
  let page = runReadwise([
    "reader-list-documents",
    "--location",
    "archive",
    "--limit",
    "50",
    "--response-fields",
    archiveFields,
    "--json",
  ]);
  pages.push(page);

  let cursor = page.nextPageCursor;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

  while (cursor && pages.length < 12) {
    page = runReadwise([
      "reader-list-documents",
      "--location",
      "archive",
      "--limit",
      "50",
      "--page-cursor",
      cursor,
      "--response-fields",
      archiveFields,
      "--json",
    ]);
    pages.push(page);
    cursor = page.nextPageCursor;

    const oldest = pages
      .flatMap((entry) => entry.results || [])
      .map((item) => parseDate(item.last_opened_at))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    if (pages.length >= 7 && oldest && oldest <= sixMonthsAgo) break;
  }

  return pages;
}

function buildHeatmap(recentlyRead) {
  const counts = new Map();
  for (const item of recentlyRead) {
    const date = parseDate(item.last_opened_at);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 182);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const weeks = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const week = [];
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      week.push({
        key,
        date: new Date(date),
        count: date <= end ? counts.get(key) || 0 : null,
      });
    }
    weeks.push(week);
  }

  const monthMarkers = [];
  let previousMonth = "";
  weeks.forEach((week, index) => {
    const anchor = week.find((day) => day.date.getUTCDate() <= 7) || week[0];
    const monthKey = `${anchor.date.getUTCFullYear()}-${anchor.date.getUTCMonth()}`;
    if (monthKey === previousMonth) return;
    monthMarkers.push({
      index,
      label: anchor.date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    });
    previousMonth = monthKey;
  });

  return { weeks, monthMarkers };
}

function renderCards(items) {
  return items
    .map((item) => {
      const image = cleanImage(item.image_url || item.image);
      const progress = Math.max(5, Math.min(99, Math.round(Number(item.reading_progress || 0) * 100)));
      const imageHtml = image
        ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.remove(); this.parentElement.classList.add('placeholder');">`
        : "";
      return `<a class="book-card ${image ? "" : "placeholder"}" style="--hue:${stableHue(
        item.title
      )};" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noreferrer">${imageHtml}<div class="cover-glow"></div><div class="card-copy"><strong>${escapeHtml(
        item.title || "Untitled"
      )}</strong><span>${escapeHtml(item.author || item.site_name || "Unknown")}</span></div><div class="progress-track"><i style="width:${progress}%"></i></div></a>`;
    })
    .join("\n");
}

function renderRows(items) {
  const grouped = new Map();
  for (const item of items) {
    const date = parseDate(item.last_opened_at);
    const key = formatMonth(date);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  return [...grouped.entries()]
    .map(([month, monthItems]) => {
      const rows = monthItems
        .map((item) => {
          const date = parseDate(item.last_opened_at);
          const category = categoryLabel(item.category);
          const source = item.author || item.site_name || category;
          return `<article class="read-row" data-category="${escapeHtml(category)}"><time>${escapeHtml(
            formatDay(date)
          )}</time><span class="emoji" aria-hidden="true">${categoryEmoji(category)}</span><div><a href="${escapeHtml(
            item.url || "#"
          )}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "Untitled")}</a><p>${escapeHtml(
            source
          )}</p></div></article>`;
        })
        .join("");
      return `<section class="month-group"><h3>${escapeHtml(month)}</h3>${rows}</section>`;
    })
    .join("\n");
}

function renderPage({ currentlyReading, recentlyRead, archivePages }) {
  const { weeks, monthMarkers } = buildHeatmap(recentlyRead);
  const currentCards = renderCards(currentlyReading);
  const readRows = renderRows(recentlyRead);
  const heatmapWeeks = weeks
    .map((week) => {
      return `<div class="week">${week
        .map((day) => {
          const count = day.count;
          const level =
            count == null ? "future" : count === 0 ? "0" : count === 1 ? "1" : count === 2 ? "2" : count <= 4 ? "3" : "4";
          const title = count == null ? "" : `${day.key}: ${count} finished`;
          return `<span class="cell level-${level}" title="${escapeHtml(title)}"></span>`;
        })
        .join("")}</div>`;
    })
    .join("\n");
  const monthLabels = monthMarkers
    .map((marker) => `<span style="grid-column:${marker.index + 1};">${escapeHtml(marker.label)}</span>`)
    .join("");

  const dateRangeDates = recentlyRead
    .map((item) => parseDate(item.last_opened_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const activityRange = dateRangeDates.length
    ? `${formatDay(dateRangeDates[0])} - ${formatDay(dateRangeDates[dateRangeDates.length - 1])}`
    : "No finished reads found";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What I'm Reading</title>
<meta name="generator" content="scripts/update-now-reading.js">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f1eb;--surface:#ede6dc;--surface-hover:#e4dbd0;--border:#d9d0c4;--text:#4a4239;--text-muted:#8a7e72;--text-dim:#b0a597;--heading:#2c251e;--accent:#a0724a;--accent-dim:rgba(160,114,74,.12)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:"DM Sans",system-ui,sans-serif;line-height:1.45}main{max-width:760px;margin:0 auto;padding:64px 22px 80px}header{padding-bottom:38px;border-bottom:1px solid var(--border)}h1{font-family:"Newsreader",serif;font-weight:300;font-size:clamp(48px,11vw,86px);line-height:.92;letter-spacing:0;margin:0;color:var(--heading)}header p{margin:16px 0 0;color:var(--text-muted);font-size:15px}a{color:inherit;text-decoration:none}header a{color:var(--accent);border-bottom:1px solid rgba(160,114,74,.35)}.section{padding:34px 0;border-bottom:1px solid var(--border);animation:fadeUp .55s ease both}.label{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin:0 0 18px}.current-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}.book-card{position:relative;display:block;aspect-ratio:3/2;border-radius:8px;overflow:hidden;background:linear-gradient(135deg,hsl(var(--hue),24%,58%),hsl(calc(var(--hue) + 38),32%,34%));box-shadow:0 10px 28px rgba(44,37,30,.1);transition:transform .18s ease,box-shadow .18s ease}.book-card:hover{transform:translateY(-3px);box-shadow:0 16px 34px rgba(44,37,30,.16)}.book-card img{width:100%;height:100%;object-fit:cover;display:block}.book-card:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.72));pointer-events:none}.cover-glow{position:absolute;inset:0;background:radial-gradient(circle at 30% 15%,rgba(255,255,255,.24),transparent 42%)}.card-copy{position:absolute;left:13px;right:13px;bottom:16px;z-index:2;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.45)}.card-copy strong{display:block;font-size:14px;line-height:1.14;max-height:49px;overflow:hidden}.card-copy span{display:block;margin-top:5px;font-size:12px;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.progress-track{position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(0,0,0,.34);z-index:3}.progress-track i{display:block;height:100%;background:var(--accent)}.empty{padding:22px;border-radius:8px;background:var(--surface);color:var(--text-muted)}.activity{width:100%;overflow:hidden}.month-labels{display:grid;grid-template-columns:repeat(${weeks.length},1fr);margin-left:34px;margin-bottom:8px;color:var(--text-dim);font-size:11px}.heatmap-wrap{display:flex;gap:8px}.days{display:grid;grid-template-rows:repeat(7,1fr);width:26px;height:104px;color:var(--text-dim);font-size:10px}.days span{align-self:center}.days span:nth-child(1),.days span:nth-child(3),.days span:nth-child(5){visibility:hidden}.weeks{display:flex;gap:3px;flex:1;min-width:0}.week{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;flex:1}.cell{display:block;aspect-ratio:1;border-radius:3px;background:var(--surface)}.level-1{background:rgba(160,114,74,.2)}.level-2{background:rgba(160,114,74,.4)}.level-3{background:rgba(160,114,74,.65)}.level-4{background:rgba(160,114,74,1)}.level-future{opacity:.28}.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}.filter{border:1px solid var(--border);background:transparent;color:var(--text-muted);border-radius:999px;padding:7px 12px;font:600 12px "DM Sans",sans-serif;cursor:pointer}.filter.active,.filter:hover{background:var(--accent-dim);border-color:rgba(160,114,74,.35);color:var(--accent)}.month-group{margin-top:26px}.month-group h3{margin:0 0 8px;color:var(--text-muted);font-size:12px;letter-spacing:.14em;text-transform:uppercase}.read-row{display:grid;grid-template-columns:72px 24px 1fr;gap:12px;align-items:baseline;padding:12px 0;border-bottom:1px solid rgba(217,208,196,.65)}.read-row time{color:var(--text-dim);font-variant-numeric:tabular-nums;font-size:13px}.emoji{font-size:15px}.read-row a{font-weight:600;color:var(--heading)}.read-row a:hover{color:var(--accent)}.read-row p{margin:3px 0 0;color:var(--text-dim);font-size:13px}.hidden{display:none}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@media (max-width:520px){main{padding:44px 16px 64px}.current-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.read-row{grid-template-columns:60px 20px 1fr;gap:9px}.month-labels{font-size:10px}.days{width:24px}.heatmap-wrap{gap:6px}.weeks,.week{gap:2px}.cell{border-radius:2px}}
</style>
</head>
<body>
<main>
<header><h1>What I'm reading</h1><p>Powered by <a href="https://readwise.io/read" target="_blank" rel="noreferrer">Readwise Reader</a></p></header>
<section class="section"><h2 class="label">Currently Reading</h2>${
    currentlyReading.length
      ? `<div class="current-grid">${currentCards}</div>`
      : '<div class="empty">No active in-progress reads found in Reader right now.</div>'
  }</section>
<section class="section"><h2 class="label">Reading Activity</h2><div class="activity"><div class="month-labels">${monthLabels}</div><div class="heatmap-wrap"><div class="days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div><div class="weeks">${heatmapWeeks}</div></div></div></section>
<section class="section"><h2 class="label">Highlight Graph</h2><div class="empty">Explore recent Readwise highlights as a connected idea graph. <a href="highlight-graph.html">Open the graph</a>.</div></section>
<section class="section"><h2 class="label">Recently Read</h2><div class="filters"><button class="filter active" data-filter="all">All</button><button class="filter" data-filter="article">Articles</button><button class="filter" data-filter="book">Books</button><button class="filter" data-filter="tweet">Tweets</button><button class="filter" data-filter="rss">RSS</button><button class="filter" data-filter="email">Email</button></div>${readRows || '<div class="empty">No finished reads found in the fetched archive pages.</div>'}</section>
</main>
<script>document.querySelectorAll('.filter').forEach(button=>{button.addEventListener('click',()=>{const filter=button.dataset.filter;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.read-row').forEach(row=>{row.classList.toggle('hidden',filter!=='all'&&row.dataset.category!==filter);});document.querySelectorAll('.month-group').forEach(group=>{const visible=Array.from(group.querySelectorAll('.read-row')).some(row=>!row.classList.contains('hidden'));group.classList.toggle('hidden',!visible);});});});</script>
</body>
</html>
`;

  return {
    html,
    summary: {
      currentlyReading: currentlyReading.length,
      recentlyRead: recentlyRead.length,
      archivePagesFetched: archivePages.length,
      archiveItemsFetched: archivePages.flatMap((page) => page.results || []).length,
      activityRange,
      generatedAt: new Date().toISOString(),
      outputFile,
    },
  };
}

function main() {
  const activeBatches = ["shortlist", "later", "new"].map((location) =>
    runReadwise([
      "reader-list-documents",
      "--location",
      location,
      "--limit",
      "50",
      "--response-fields",
      activeFields,
      "--json",
    ])
  );
  const archivePages = fetchArchivePages();

  const active = new Map();
  for (const batch of activeBatches) {
    for (const item of batch.results || []) active.set(itemKey(item), item);
  }

  const currentlyReading = [...active.values()]
    .filter((item) => Number(item.reading_progress || 0) >= 0.05 && Number(item.reading_progress || 0) < 0.99)
    .sort((a, b) => lastOpenedTime(b) - lastOpenedTime(a));
  const recentlyRead = archivePages
    .flatMap((page) => page.results || [])
    .filter((item) => Number(item.reading_progress || 0) > 0.9 && parseDate(item.last_opened_at))
    .sort((a, b) => lastOpenedTime(b) - lastOpenedTime(a));

  const { html, summary } = renderPage({ currentlyReading, recentlyRead, archivePages });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, html, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
