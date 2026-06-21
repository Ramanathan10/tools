const fs = require("fs");
const path = require("path");
const { publicTools, repoRoot } = require("./public-tools");

const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");

const checks = [
  {
    id: "embedded-credential",
    severity: "high",
    pattern:
      /(?:\b(?:const|let|var)\s+[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN)[A-Z0-9_]*\s*=\s*["'][A-Za-z0-9._-]{12,}["']|\b(?:authorization:\s*bearer|bearer\s+)[A-Za-z0-9._-]{12,})/i,
  },
  {
    id: "local-path",
    severity: "high",
    pattern: /\b(?:[A-Z]:\\|C:\/Users\/|C:\/repos\/|\.openclaw|ObsidianVault)\b/i,
  },
  {
    id: "raw-trading-detail",
    severity: "high",
    pattern: /"(?:openPositions|executionDetails|avgEntry|avgExit|quantity|realizedPnl)"/i,
  },
  {
    id: "inline-private-url",
    severity: "medium",
    pattern: /\b(?:localhost|127\.0\.0\.1|private-user-images\.githubusercontent\.com)\b/i,
  },
];

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function readLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function scanFile(filePath) {
  const lines = readLines(filePath);
  const findings = [];

  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (check.pattern.test(line)) {
        findings.push({
          check: check.id,
          severity: check.severity,
          file: relative(filePath),
          line: index + 1,
          snippet: line.trim().slice(0, 180),
        });
      }
    }
  }

  return findings;
}

function uniqueFiles(files) {
  return [...new Set(files.map((file) => path.resolve(file)))];
}

const sourceFiles = uniqueFiles([
  path.join(repoRoot, "index.html"),
  path.join(repoRoot, "assets", "tool-shell.css"),
  ...publicTools.map((tool) => tool.source),
]);

const missingFiles = sourceFiles.filter((file) => !fs.existsSync(file));
const findings = [];

for (const file of sourceFiles) {
  if (fs.existsSync(file)) {
    findings.push(...scanFile(file));
  }
}

const result = {
  ok: missingFiles.length === 0 && findings.length === 0,
  scannedFiles: sourceFiles.map(relative),
  publicTools: publicTools.map((tool) => ({ name: tool.name, href: tool.href })),
  missingFiles: missingFiles.map(relative),
  findingCount: findings.length,
  findings,
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Public preflight clean: scanned ${sourceFiles.length} catalog files.`);
} else {
  for (const missingFile of result.missingFiles) {
    console.error(`missing-file ${missingFile}`);
  }
  for (const finding of findings) {
    console.error(
      `${finding.severity} ${finding.check} ${finding.file}:${finding.line} ${finding.snippet}`
    );
  }
}

process.exit(result.ok ? 0 : 1);
