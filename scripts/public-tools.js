const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const publicTools = [
  {
    name: "copilot-session-viewer",
    href: "copilot-session-viewer.html",
    source: path.join(repoRoot, "copilot-session-viewer.html"),
    description:
      "Turn exported Copilot session JSON into a readable local timeline with source-linked findings, copyable review briefs, and collapsible tool payloads.",
  },
  {
    name: "json-to-yaml",
    href: "json-to-yaml.html",
    source: path.join(repoRoot, "json-to-yaml.html"),
    description:
      "Paste JSON, get clean YAML. Built for quick config and data handoffs without opening a heavyweight editor.",
  },
  {
    name: "swing-risk",
    href: "swing-risk/",
    source: path.join(repoRoot, "swing-risk", "index.html"),
    description:
      "Size a swing trade from entry, stop, target, account risk, and max capital without storing private trading data.",
  },
];

module.exports = {
  publicTools,
  repoRoot,
};
