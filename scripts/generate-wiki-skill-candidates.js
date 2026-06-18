const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const defaultWikiRoot = "C:\\repos\\ObsidianVault\\Wikis";
const wikiRoot = process.env.WIKI_ROOT || defaultWikiRoot;
const outputDir = path.join(repoRoot, "wiki-skill-candidates");
const outputFile = path.join(outputDir, "index.html");
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const checkMode = args.has("--check");

const proceduralTerms = [
  "workflow",
  "process",
  "checklist",
  "procedure",
  "pattern",
  "rule",
  "rubric",
  "audit",
  "maintenance",
  "preflight",
  "triage",
  "pipeline",
  "handoff",
  "prompt",
  "command",
  "failure mode",
  "invariant",
  "runbook",
  "playbook",
  "framework",
  "system",
];

const themeRules = [
  { id: "agent-workflows", label: "Agent Workflows", terms: ["agent", "codex", "claude", "copilot", "mcp", "harness", "subagent", "prompt"] },
  { id: "wiki-operations", label: "Wiki Operations", terms: ["wiki", "vault", "reader", "readwise", "archive", "highlight", "ingest", "synthesis"] },
  { id: "trading-process", label: "Trading Process", terms: ["trading", "trade", "position", "stop", "risk", "breakout", "relative strength", "market"] },
  { id: "finance-analysis", label: "Finance Analysis", terms: ["valuation", "business model", "capex", "moat", "strategy", "antitrust", "earnings"] },
  { id: "productivity-systems", label: "Productivity Systems", terms: ["productivity", "promotion", "reading", "review", "decision", "planning", "habit"] },
  { id: "tooling-ops", label: "Tooling Ops", terms: ["tool", "dashboard", "observability", "cron", "automation", "preflight", "debug"] },
];

function walkMarkdownFiles(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Wiki root not found: ${root}`);
  }

  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) {
    return { data: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: raw };
  }

  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4);
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      data[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

function titleFromPath(filePath) {
  return path.basename(filePath, ".md")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function countOccurrences(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) || []).length;
}

function extractHeadings(body) {
  return [...body.matchAll(/^#{2,4}\s+(.+)$/gm)].map((match) => match[1].trim());
}

function extractLinks(body) {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function scorePage(page) {
  const text = normalizeText(`${page.title} ${page.headings.join(" ")} ${page.body}`);
  let score = 0;
  const evidence = [];

  for (const term of proceduralTerms) {
    const count = countOccurrences(text, term);
    if (count > 0) {
      score += Math.min(count, 5);
      if (evidence.length < 5) {
        evidence.push(term);
      }
    }
  }

  const workflowHeadings = page.headings.filter((heading) => /how|workflow|process|maintenance|pattern|checklist|rule|key points|open questions|connections/i.test(heading));
  score += workflowHeadings.length * 2;
  score += Math.min(page.links.length, 12) * 0.35;
  if (/how|workflow|pattern|maintenance|checklist|framework/i.test(page.title)) {
    score += 5;
  }

  return {
    score: Math.round(score * 10) / 10,
    evidence,
    workflowHeadings: workflowHeadings.slice(0, 5),
  };
}

function chooseTheme(page) {
  const text = normalizeText(`${page.domain} ${page.title} ${page.headings.join(" ")} ${page.links.join(" ")} ${page.body.slice(0, 2000)}`);
  let best = { id: "general", label: page.domain || "General", score: 0 };

  for (const rule of themeRules) {
    const score = rule.terms.reduce((sum, term) => sum + countOccurrences(text, term), 0);
    if (score > best.score) {
      best = { id: rule.id, label: rule.label, score };
    }
  }

  return best;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function skillNameFor(cluster) {
  return `${slugify(cluster.theme.label)}-${slugify(cluster.domain)}`
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function summarizePage(page) {
  const firstParagraph = page.body
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/^#+\s+.*$/gm, "").trim())
    .find((part) => part.length > 80);
  return (firstParagraph || page.headings.slice(0, 3).join("; ") || page.title)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function buildReport() {
  const pages = walkMarkdownFiles(wikiRoot)
    .filter((filePath) => !["index.md", "log.md"].includes(path.basename(filePath).toLowerCase()))
    .map((filePath) => {
      const raw = fs.readFileSync(filePath, "utf8");
      const { data, body } = parseFrontmatter(raw);
      const relativePath = path.relative(wikiRoot, filePath);
      const domain = data.domain || relativePath.split(path.sep)[0] || "General";
      const page = {
        filePath,
        relativePath: relativePath.replace(/\\/g, "/"),
        title: data.title || titleFromPath(filePath),
        domain,
        updated: data.updated || "",
        body,
        headings: extractHeadings(body),
        links: extractLinks(body),
      };
      const scored = scorePage(page);
      const theme = chooseTheme(page);
      return { ...page, ...scored, theme, summary: summarizePage(page) };
    })
    .filter((page) => page.score >= 7);

  const clusterMap = new Map();
  for (const page of pages) {
    const key = `${page.domain}::${page.theme.id}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        domain: page.domain,
        theme: page.theme,
        pages: [],
        score: 0,
      });
    }
    const cluster = clusterMap.get(key);
    cluster.pages.push(page);
    cluster.score += page.score;
  }

  const clusters = [...clusterMap.values()]
    .map((cluster) => {
      const pagesSorted = cluster.pages.sort((a, b) => b.score - a.score).slice(0, 7);
      const averageScore = cluster.score / cluster.pages.length;
      const title = `${cluster.theme.label} in ${cluster.domain}`;
      return {
        title,
        domain: cluster.domain,
        theme: cluster.theme.label,
        skillName: skillNameFor(cluster),
        score: Math.round((cluster.score + averageScore * 2 + Math.min(cluster.pages.length, 6) * 4) * 10) / 10,
        pageCount: cluster.pages.length,
        pages: pagesSorted,
        outline: [
          `When to use: ${title.toLowerCase()} questions or repeated workflow execution.`,
          `Inputs: source wiki pages, current user request, and any live tool context required by the workflow.`,
          `Procedure: retrieve the strongest source pages, extract constraints and steps, execute only confirmed actions, and cite source paths in the final brief.`,
          `Guardrails: do not convert reference-only notes into standing procedures; ask before durable skill creation or external actions.`,
        ],
      };
    })
    .filter((cluster) => cluster.pageCount >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    wikiRoot,
    pageCount: pages.length,
    candidateCount: clusters.length,
    clusters,
  };
}

function renderHtml(report) {
  const cards = report.clusters.map((cluster, index) => {
    const pages = cluster.pages.map((page) => `
          <li>
            <a href="file:///${escapeHtml(page.filePath.replace(/\\/g, "/"))}">${escapeHtml(page.title)}</a>
            <span>${escapeHtml(page.relativePath)} · score ${escapeHtml(page.score)}</span>
            <p>${escapeHtml(page.summary)}</p>
            <small>Evidence: ${escapeHtml([...new Set([...page.evidence, ...page.workflowHeadings])].slice(0, 6).join(", ") || "linked procedural structure")}</small>
          </li>`).join("");

    const outline = cluster.outline.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

    return `
      <article class="candidate" id="${escapeHtml(cluster.skillName)}">
        <div class="rank">${index + 1}</div>
        <div class="candidate-body">
          <p class="eyebrow">${escapeHtml(cluster.domain)} · ${escapeHtml(cluster.theme)} · ${escapeHtml(cluster.pageCount)} pages</p>
          <h2>${escapeHtml(cluster.title)}</h2>
          <div class="meta">
            <code>${escapeHtml(cluster.skillName)}</code>
            <span>cluster score ${escapeHtml(cluster.score)}</span>
          </div>
          <h3>Suggested Skill Outline</h3>
          <ul class="outline">${outline}</ul>
          <h3>Source Evidence</h3>
          <ul class="sources">${pages}</ul>
        </div>
      </article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wiki Skill Candidates</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090b0e;
      --panel: #11171d;
      --line: #26313a;
      --text: #f4f7fb;
      --muted: #9ba8b5;
      --accent: #63e6be;
      --accent-2: #ffd166;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 42px 0 64px;
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      align-items: end;
      border-bottom: 1px solid var(--line);
      padding-bottom: 24px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.25rem, 6vw, 4.8rem);
      line-height: 0.96;
      letter-spacing: 0;
    }
    .lede {
      max-width: 700px;
      margin: 16px 0 0;
      color: var(--muted);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(96px, 1fr));
      gap: 8px;
      min-width: min(100%, 360px);
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel);
    }
    .stat strong {
      display: block;
      color: var(--accent);
      font-size: 1.35rem;
    }
    .stat span {
      color: var(--muted);
      font-size: 0.8rem;
    }
    .candidate {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 14px;
      padding: 22px 0;
      border-bottom: 1px solid var(--line);
    }
    .rank {
      width: 42px;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: var(--accent-2);
      font-weight: 800;
      background: var(--panel);
    }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--accent);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h2 {
      margin: 0;
      font-size: clamp(1.45rem, 3vw, 2.15rem);
      line-height: 1.1;
      letter-spacing: 0;
    }
    h3 {
      margin: 22px 0 8px;
      color: var(--muted);
      font-size: 0.9rem;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    code {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0c1116;
      color: var(--text);
      padding: 3px 7px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    .outline li {
      margin: 5px 0;
    }
    .sources {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
      gap: 10px;
      padding: 0;
      list-style: none;
    }
    .sources li {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
    }
    .sources a {
      color: var(--text);
      font-weight: 800;
      text-decoration: none;
    }
    .sources a:hover {
      color: var(--accent);
    }
    .sources span,
    .sources small {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      margin-top: 4px;
    }
    .sources p {
      margin: 9px 0 0;
      color: #ced6df;
      font-size: 0.92rem;
    }
    footer {
      margin-top: 24px;
      color: var(--muted);
      font-size: 0.86rem;
    }
    @media (max-width: 760px) {
      header,
      .candidate {
        grid-template-columns: 1fr;
      }
      .stats {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Wiki Skill Candidates</h1>
        <p class="lede">A generated review queue for turning Ram's wiki clusters into reusable skills. It proposes candidates only; skill creation still needs an explicit human confirmation.</p>
      </div>
      <section class="stats" aria-label="Report stats">
        <div class="stat"><strong>${escapeHtml(report.candidateCount)}</strong><span>candidates</span></div>
        <div class="stat"><strong>${escapeHtml(report.pageCount)}</strong><span>scored pages</span></div>
        <div class="stat"><strong>${escapeHtml(report.clusters.reduce((sum, cluster) => sum + cluster.pageCount, 0))}</strong><span>source hits</span></div>
      </section>
    </header>
${cards}
    <footer>
      Generated ${escapeHtml(report.generatedAt)} from ${escapeHtml(report.wikiRoot)}. Refresh with <code>node scripts/generate-wiki-skill-candidates.js --json</code>.
    </footer>
  </main>
</body>
</html>
`;
}

try {
  const report = buildReport();
  const html = renderHtml(report);
  const currentHtml = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
  const indexCurrent = currentHtml === html;

  if (!checkMode) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputFile, html, "utf8");
  }

  const result = {
    ok: checkMode ? indexCurrent : true,
    mode: checkMode ? "check" : "generate",
    indexCurrent: checkMode ? indexCurrent : true,
    outputFile,
    wikiRoot,
    candidateCount: report.candidateCount,
    pageCount: report.pageCount,
    topCandidate: report.clusters[0]?.title || null,
  };

  if (checkMode && !indexCurrent) {
    result.error = "wiki-skill-candidates/index.html is out of date; run node scripts/generate-wiki-skill-candidates.js.";
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`Generated ${report.candidateCount} wiki skill candidates at ${outputFile}.`);
  } else {
    console.error(result.error);
  }

  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const result = {
    ok: false,
    error: error.message,
    wikiRoot,
  };
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
