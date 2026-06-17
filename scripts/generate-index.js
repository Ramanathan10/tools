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
  ["swing-risk", "Size a swing trade from entry, stop, target, account risk, and max capital before it hits Ram's trading notes."],
  ["trading-calendar", "Monthly trading archive with executions, P&L, and session context for Ram's swing-trading review loop."],
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
    return `      <a class="tool" href="${escapeHtml(tool.href)}">
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
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a0d;
      --panel: #11161c;
      --panel-hover: #151d25;
      --line: #28323d;
      --text: #f4f7fb;
      --muted: #9aa7b5;
      --accent: #00e887;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
    }
    main {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 44px 0;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.5rem, 8vw, 5rem);
      line-height: 0.95;
      letter-spacing: 0;
    }
    .lede {
      max-width: 640px;
      margin: 18px 0 30px;
      color: var(--muted);
      font-size: 1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .tool {
      min-height: 170px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: inherit;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 18px;
      text-decoration: none;
    }
    .tool:hover,
    .tool:focus-visible {
      background: var(--panel-hover);
      border-color: color-mix(in srgb, var(--accent), var(--line) 35%);
      outline: none;
    }
    .tool-label {
      color: var(--accent);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .tool strong {
      display: block;
      margin: 18px 0 10px;
      font-size: 1.55rem;
      line-height: 1.05;
    }
    .tool span:last-child {
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main>
    <h1>Tools</h1>
    <p class="lede">Small, practical utilities for Ram's recurring workflows.</p>
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
