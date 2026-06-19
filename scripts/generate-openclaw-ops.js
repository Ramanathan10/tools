const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const openclawRoot = process.env.OPENCLAW_HOME || path.join(process.env.USERPROFILE || "", ".openclaw");
const outputDir = path.join(repoRoot, "openclaw-ops");
const outputFile = path.join(outputDir, "index.html");
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const checkMode = args.has("--check");
const includeLive = args.has("--include-live");
const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;
const liveGraceMs = 2 * 60 * 1000;
const windows = [7, 30];

function walk(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, files);
    } else if (predicate(fullPath, entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(safeJson)
    .filter(Boolean);
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function inferAgent(filePath) {
  const match = filePath.match(/[\\/]agents[\\/]([^\\/]+)/i);
  return match ? match[1] : "unknown";
}

function inferSessionId(filePath, events) {
  const meta = events.find((event) => event.type === "session_meta" && event.payload?.id);
  if (meta) {
    return meta.payload.id;
  }
  return path.basename(filePath, ".jsonl").replace(/^rollout-/, "");
}

function firstUserText(events) {
  for (const event of events) {
    const text = event.payload?.message?.content || event.message?.content || event.payload?.text || "";
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
    const items = event.payload?.message?.content || event.message?.content;
    if (Array.isArray(items)) {
      const content = items
        .map((item) => (typeof item === "string" ? item : item.text || ""))
        .join(" ")
        .trim();
      if (content) {
        return content;
      }
    }
  }
  return "";
}

function inferJob(text, filePath) {
  const cron = text.match(/\[cron:[^\s\]]+\s+([^\]]+)\]/i);
  if (cron) {
    return cron[1].trim();
  }
  const lower = text.toLowerCase();
  if (lower.includes("now reading")) return "now-reading";
  if (lower.includes("trading calendar")) return "trading-calendar";
  if (lower.includes("morning brief")) return "morning-brief";
  if (lower.includes("heartbeat")) return "heartbeat";
  if (lower.includes("nightly-tool-builder")) return "nightly-tool-builder";
  return path.basename(filePath).startsWith("rollout-") ? "interactive/agent" : "openclaw-session";
}

function summarizePrompt(text) {
  if (!text) {
    return "(no prompt text)";
  }
  return text.replace(/\s+/g, " ").slice(0, 180);
}

function collectRuns() {
  const agentsDir = path.join(openclawRoot, "agents");
  const files = walk(
    agentsDir,
    (filePath) => filePath.endsWith(".jsonl") && filePath.includes(`${path.sep}codex-home${path.sep}sessions${path.sep}`)
  );

  const runs = [];
  for (const filePath of files) {
    if (!includeLive && now - fs.statSync(filePath).mtimeMs < liveGraceMs) {
      continue;
    }

    const events = readJsonl(filePath);
    let firstTimestamp = null;
    let lastTimestamp = null;
    let maxUsage = null;
    let completed = false;
    let completionMessage = "";
    let model = "";

    for (const event of events) {
      const eventTime = parseTimestamp(event.timestamp || event.payload?.timestamp);
      if (eventTime) {
        firstTimestamp = firstTimestamp ? Math.min(firstTimestamp, eventTime) : eventTime;
        lastTimestamp = lastTimestamp ? Math.max(lastTimestamp, eventTime) : eventTime;
      }

      if (event.type === "session_meta") {
        model = event.payload?.model || event.payload?.model_provider || model;
      }

      if (event.payload?.type === "token_count") {
        const usage = event.payload.info?.total_token_usage;
        if (usage && (!maxUsage || (usage.total_tokens || 0) >= (maxUsage.total_tokens || 0))) {
          maxUsage = usage;
        }
      }

      if (event.payload?.type === "task_complete") {
        completed = true;
        completionMessage = event.payload.last_agent_message || "";
      }
    }

    if (!firstTimestamp && !maxUsage) {
      continue;
    }

    const text = firstUserText(events);
    runs.push({
      id: inferSessionId(filePath, events),
      agent: inferAgent(filePath),
      job: inferJob(text, filePath),
      prompt: summarizePrompt(text),
      filePath,
      startedAt: firstTimestamp ? new Date(firstTimestamp).toISOString() : "",
      endedAt: lastTimestamp ? new Date(lastTimestamp).toISOString() : "",
      ageDays: firstTimestamp ? Math.floor((now - firstTimestamp) / dayMs) : null,
      completed,
      completionMessage: summarizePrompt(completionMessage),
      model,
      inputTokens: maxUsage?.input_tokens || 0,
      cachedInputTokens: maxUsage?.cached_input_tokens || 0,
      outputTokens: maxUsage?.output_tokens || 0,
      reasoningOutputTokens: maxUsage?.reasoning_output_tokens || 0,
      totalTokens: maxUsage?.total_tokens || 0,
    });
  }

  return runs
    .filter((run) => run.totalTokens > 0)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function groupBy(runs, key) {
  const groups = new Map();
  for (const run of runs) {
    const name = run[key] || "unknown";
    const group = groups.get(name) || {
      name,
      runs: 0,
      completed: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      latestAt: "",
    };
    group.runs += 1;
    group.completed += run.completed ? 1 : 0;
    group.totalTokens += run.totalTokens;
    group.inputTokens += run.inputTokens;
    group.outputTokens += run.outputTokens + run.reasoningOutputTokens;
    group.cachedInputTokens += run.cachedInputTokens;
    group.latestAt = !group.latestAt || run.startedAt > group.latestAt ? run.startedAt : group.latestAt;
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function fmt(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function dateLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRows(rows, columns) {
  return rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${column.render(row)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
}

function buildHtml(runs) {
  const byWindow = new Map(windows.map((days) => [days, runs.filter((run) => run.ageDays !== null && run.ageDays < days)]));
  const last30 = byWindow.get(30);
  const last7 = byWindow.get(7);
  const byAgent = groupBy(last30, "agent").slice(0, 10);
  const byJob = groupBy(last30, "job").slice(0, 12);
  const topRuns = last30.slice().sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20);
  const totals30 = last30.reduce((sum, run) => sum + run.totalTokens, 0);
  const totals7 = last7.reduce((sum, run) => sum + run.totalTokens, 0);
  const completed30 = last30.filter((run) => run.completed).length;
  const generatedAt = new Date().toISOString();

  const agentRows = renderRows(byAgent, [
    { render: (row) => `<strong>${escapeHtml(row.name)}</strong>` },
    { render: (row) => fmt(row.totalTokens) },
    { render: (row) => fmt(Math.round(row.totalTokens / row.runs)) },
    { render: (row) => fmt(row.runs) },
    { render: (row) => dateLabel(row.latestAt) },
  ]);

  const jobRows = renderRows(byJob, [
    { render: (row) => `<strong>${escapeHtml(row.name)}</strong>` },
    { render: (row) => fmt(row.totalTokens) },
    { render: (row) => fmt(Math.round(row.totalTokens / row.runs)) },
    { render: (row) => fmt(row.runs) },
    { render: (row) => `${Math.round((row.completed / row.runs) * 100)}%` },
  ]);

  const runRows = renderRows(topRuns, [
    { render: (row) => `<strong>${escapeHtml(row.job)}</strong><span>${escapeHtml(row.prompt)}</span>` },
    { render: (row) => escapeHtml(row.agent) },
    { render: (row) => fmt(row.totalTokens) },
    { render: (row) => fmt(row.cachedInputTokens) },
    { render: (row) => dateLabel(row.startedAt) },
    { render: (row) => escapeHtml(row.completed ? "complete" : "open") },
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenClaw Ops</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a0d;
      --panel: #11161c;
      --panel-2: #151d25;
      --line: #28323d;
      --text: #f4f7fb;
      --muted: #9aa7b5;
      --accent: #00e887;
      --accent-2: #61a8ff;
      --warn: #f4b942;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 38px 0 58px;
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.2rem, 7vw, 4.8rem);
      line-height: 0.96;
      letter-spacing: 0;
    }
    .lede {
      max-width: 760px;
      margin: 14px 0 0;
      color: var(--muted);
    }
    .meta {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      color: var(--muted);
      min-width: 220px;
      font-size: 0.84rem;
    }
    .meta strong {
      display: block;
      color: var(--text);
      font-size: 1.6rem;
      line-height: 1;
      margin-bottom: 4px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
    }
    .stat strong {
      display: block;
      color: var(--accent);
      font-size: 1.55rem;
      line-height: 1.1;
    }
    .stat span {
      color: var(--muted);
      font-size: 0.82rem;
    }
    section {
      margin-top: 24px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 1rem;
      color: var(--accent-2);
      letter-spacing: 0;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 0.9rem;
    }
    th {
      color: var(--muted);
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      background: var(--panel-2);
    }
    tr:last-child td {
      border-bottom: 0;
    }
    td strong {
      display: block;
      color: var(--text);
    }
    td span {
      display: block;
      color: var(--muted);
      max-width: 520px;
      margin-top: 4px;
      font-size: 0.82rem;
    }
    code {
      color: var(--warn);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.84em;
    }
    .note {
      color: var(--muted);
      margin: 18px 0 0;
      font-size: 0.9rem;
    }
    @media (max-width: 780px) {
      header {
        grid-template-columns: 1fr;
      }
      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      main {
        width: min(100% - 24px, 1180px);
        padding-top: 28px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>OpenClaw Ops</h1>
        <p class="lede">Token and automation leaderboard for Ram's local OpenClaw agents and Codex-backed cron work.</p>
      </div>
      <div class="meta">
        <strong>${fmt(runs.length)}</strong>
        token-bearing runs scanned<br />
        Generated ${escapeHtml(dateLabel(generatedAt))}
      </div>
    </header>

    <div class="stats">
      <div class="stat"><strong>${fmt(totals7)}</strong><span>tokens in last 7 days</span></div>
      <div class="stat"><strong>${fmt(totals30)}</strong><span>tokens in last 30 days</span></div>
      <div class="stat"><strong>${fmt(last30.length)}</strong><span>runs in last 30 days</span></div>
      <div class="stat"><strong>${Math.round((completed30 / Math.max(1, last30.length)) * 100)}%</strong><span>completion signal</span></div>
    </div>

    <section>
      <h2>Top Agents, Last 30 Days</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Total Tokens</th><th>Avg / Run</th><th>Runs</th><th>Latest</th></tr></thead>
          <tbody>${agentRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Top Jobs, Last 30 Days</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Job</th><th>Total Tokens</th><th>Avg / Run</th><th>Runs</th><th>Completion</th></tr></thead>
          <tbody>${jobRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Largest Runs, Last 30 Days</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Run</th><th>Agent</th><th>Total</th><th>Cached Input</th><th>Started</th><th>Status</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>
    </section>

    <p class="note">Source: local <code>${escapeHtml(path.join(openclawRoot, "agents", "*", "agent", "codex-home", "sessions"))}</code> JSONL token_count events. Run <code>node scripts/generate-openclaw-ops.js</code> to refresh.</p>
  </main>
</body>
</html>
`;
}

const runs = collectRuns();
const html = buildHtml(runs);
const currentHtml = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
const isCurrent = currentHtml === html;
const result = {
  ok: true,
  mode: checkMode ? "check" : "generate",
  output: outputFile,
  openclawRoot,
  runCount: runs.length,
  last7Tokens: runs.filter((run) => run.ageDays !== null && run.ageDays < 7).reduce((sum, run) => sum + run.totalTokens, 0),
  last30Tokens: runs.filter((run) => run.ageDays !== null && run.ageDays < 30).reduce((sum, run) => sum + run.totalTokens, 0),
  dashboardCurrent: isCurrent,
};

if (checkMode && !isCurrent) {
  result.ok = false;
  result.error = "openclaw-ops/index.html is out of date; run node scripts/generate-openclaw-ops.js.";
}

if (!checkMode) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, html, "utf8");
  result.dashboardCurrent = true;
}

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(
    checkMode
      ? `OpenClaw Ops preflight clean with ${runs.length} token-bearing runs.`
      : `Generated OpenClaw Ops with ${runs.length} token-bearing runs.`
  );
} else {
  console.error(result.error);
}

process.exit(result.ok ? 0 : 1);
