const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputFile = path.join(repoRoot, "index.html");
const excludedDirs = new Set([".git", ".github", "scripts"]);

const fileTools = fs
  .readdirSync(repoRoot)
  .filter((file) => file.endsWith(".html"))
  .filter((file) => file !== "index.html")
  .map((file) => ({
    href: file,
    name: path.basename(file, ".html"),
  }));

const directoryTools = fs
  .readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => !excludedDirs.has(entry.name))
  .filter((entry) => fs.existsSync(path.join(repoRoot, entry.name, "index.html")))
  .map((entry) => ({
    href: `${entry.name}/`,
    name: entry.name,
  }));

const toolsByName = new Map();
for (const tool of [...fileTools, ...directoryTools]) {
  if (!toolsByName.has(tool.name)) {
    toolsByName.set(tool.name, tool);
  }
}
const tools = [...toolsByName.values()].sort((a, b) => a.name.localeCompare(b.name));

const links = tools
  .map((tool) => {
    const title = tool.name
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return `<li><a href="${tool.href}">${title}</a></li>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tools</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 16px;
      line-height: 1.5;
    }
    h1 {
      margin-bottom: 16px;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <h1>Tools</h1>
  <ul>
    ${links}
  </ul>
</body>
</html>`;

fs.writeFileSync(outputFile, html, "utf8");
console.log(`Generated index.html with ${tools.length} tools.`);
