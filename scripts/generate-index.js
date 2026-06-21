const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputFile = path.join(repoRoot, "index.html");
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const checkMode = args.has("--check");
const publicTools = [
  {
    name: "copilot-session-viewer",
    href: "copilot-session-viewer.html",
    source: path.join(repoRoot, "copilot-session-viewer.html"),
  },
  {
    name: "json-to-yaml",
    href: "json-to-yaml.html",
    source: path.join(repoRoot, "json-to-yaml.html"),
  },
  {
    name: "swing-risk",
    href: "swing-risk/",
    source: path.join(repoRoot, "swing-risk", "index.html"),
  },
];
const toolDescriptions = new Map([
  ["copilot-session-viewer", "Turn exported Copilot session JSON into a readable local timeline with source-linked findings, copyable review briefs, and collapsible tool payloads."],
  ["json-to-yaml", "Paste JSON, get clean YAML. Built for quick config and data handoffs without opening a heavyweight editor."],
  ["swing-risk", "Size a swing trade from entry, stop, target, account risk, and max capital without storing private trading data."],
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

const missingPublicTools = publicTools.filter((tool) => !fs.existsSync(tool.source));
if (missingPublicTools.length > 0) {
  const message = `Public catalog tools are missing source files: ${missingPublicTools.map((tool) => tool.name).join(", ")}`;
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, error: message, missingPublicTools }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

const catalog = publicTools.map((tool) => ({
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
        <a href="swing-risk/">Swing Risk</a>
      </div>
    </nav>
    <section class="hero">
      <div>
        <div class="eyebrow">Personal Utilities</div>
        <h1>Tools</h1>
        <p class="lede">Small public utilities. Private dashboards live behind Trojan Lab auth.</p>
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
