const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputFile = path.join(repoRoot, "index.html");
const excludedDirs = new Set([".git", ".github", "scripts", "tools"]);
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const checkMode = args.has("--check");
const toolDescriptions = new Map([
  ["agents-command-center", "Read-only map of Ram's OpenClaw agents, personal skills, recurring workflows, owners, lanes, and source paths."],
  ["copilot-session-viewer", "Turn exported Copilot session JSON into a readable local timeline with source-linked findings, copyable review briefs, and collapsible tool payloads."],
  ["json-to-yaml", "Paste JSON, get clean YAML. Built for quick config and data handoffs without opening a heavyweight editor."],
  ["now-reading", "A warm Readwise Reader page showing current reads, finished reading history, and a six-month activity heatmap."],
  ["openclaw-ops", "Generated token and automation leaderboard for Ram's local OpenClaw agents, cron jobs, and Codex-backed runs."],
  ["swing-risk", "Size a swing trade from entry, stop, target, account risk, and max capital before it hits Ram's trading notes."],
  ["trading-calendar", "Monthly trading archive with executions, P&L, and session context for Ram's swing-trading review loop."],
  ["wiki-skill-candidates", "Generated review queue that finds Ram's wiki clusters most suitable for reusable agent skills."],
]);

function readTitle(filePath, fallback) {
  const html = fs.readFileSync(filePath, "utf8");
  const match = html.match(/<title>(.*?)<\/title>/is);
  if (!match) {
    return formatName(fallback);
  }

  return match[1].replace(/\s+/g, " ").trim();
}

function formatName(name) {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeTool(name) {
  return toolDescriptions.get(name) ?? "Small personal utility for Ram's recurring workflows.";
}

function getNestedOnlyTools() {
  const nestedToolsDir = path.join(repoRoot, "tools");
  if (!fs.existsSync(nestedToolsDir)) {
    return [];
  }

  return fs
    .readdirSync(nestedToolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.name.endsWith(".html"))
    .map((entry) => {
      const name = entry.isDirectory() ? entry.name : path.basename(entry.name, ".html");
      const rootFile = path.join(repoRoot, `${name}.html`);
      const rootDir = path.join(repoRoot, name, "index.html");
      return { name, hasRootTool: fs.existsSync(rootFile) || fs.existsSync(rootDir) };
    })
    .filter((tool) => !tool.hasRootTool)
    .map((tool) => tool.name);
}

const nestedOnlyTools = getNestedOnlyTools();
if (nestedOnlyTools.length > 0) {
  const message = `Nested-only tools are not listed on the public root index: ${nestedOnlyTools.join(", ")}`;
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, error: message, nestedOnlyTools }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

const fileTools = fs
  .readdirSync(repoRoot)
  .filter((file) => file.endsWith(".html"))
  .filter((file) => file !== "index.html")
  .map((file) => ({
    href: file,
    name: path.basename(file, ".html"),
    source: path.join(repoRoot, file),
  }));

const directoryTools = fs
  .readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => !excludedDirs.has(entry.name))
  .filter((entry) => fs.existsSync(path.join(repoRoot, entry.name, "index.html")))
  .map((entry) => ({
    href: `${entry.name}/`,
    name: entry.name,
    source: path.join(repoRoot, entry.name, "index.html"),
  }));

const toolsByName = new Map();
for (const tool of [...fileTools, ...directoryTools]) {
  if (!toolsByName.has(tool.name)) {
    toolsByName.set(tool.name, tool);
  }
}
const tools = [...toolsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
const catalog = tools.map((tool) => ({
  name: tool.name,
  href: tool.href,
  title: readTitle(tool.source, tool.name),
  label: formatName(tool.name),
  description: describeTool(tool.name),
}));

const links = catalog
  .map((tool) => {
    return `      <a class="tool-card" href="${escapeHtml(tool.href)}">
        <span class="tool-label">${escapeHtml(tool.label)}</span>
        <strong>${escapeHtml(tool.title)}</strong>
        <span>${escapeHtml(tool.description)}</span>
      </a>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tools</title>
  <link rel="stylesheet" href="assets/tool-shell.css" />
</head>
<body>
  <main class="shell">
    <nav class="shell-topbar" aria-label="Tools navigation">
      <a class="shell-brand" href="./">Ram Tools</a>
      <div class="shell-nav">
        <a href="json-to-yaml.html">JSON YAML</a>
        <a href="trading-calendar/">Trading</a>
        <a href="openclaw-ops/">Ops</a>
      </div>
    </nav>
    <section class="hero">
      <div>
        <div class="eyebrow">Personal Utilities</div>
        <h1>Tools</h1>
        <p class="lede">Small, practical utilities for Ram's recurring workflows.</p>
      </div>
    </section>
    <section class="grid" aria-label="Available tools">
${links}
    </section>
  </main>
</body>
</html>
`;

const currentHtml = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
const isCurrent = currentHtml === html;
const result = {
  ok: true,
  mode: checkMode ? "check" : "generate",
  indexCurrent: isCurrent,
  toolCount: catalog.length,
  tools: catalog.map(({ name, href, title }) => ({ name, href, title })),
};

if (checkMode && !isCurrent) {
  result.ok = false;
  result.error = "index.html is out of date; run node scripts/generate-index.js.";
}

if (!checkMode) {
  fs.writeFileSync(outputFile, html, "utf8");
  result.indexCurrent = true;
}

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(
    checkMode
      ? `Index preflight clean with ${catalog.length} tools.`
      : `Generated index.html with ${catalog.length} tools.`
  );
} else {
  console.error(result.error);
}

process.exit(result.ok ? 0 : 1);
