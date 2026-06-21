# tools.github.io

Small static utilities for Ram's recurring workflows.

## Shared Tool Shell

Use `assets/tool-shell.css` for new browser-only tools so the site feels like one command surface instead of unrelated standalone pages.

Minimum shape:

```html
<link rel="stylesheet" href="../assets/tool-shell.css" />
<main class="shell">
  <nav class="shell-topbar">
    <a class="shell-brand" href="../">Ram Tools</a>
    <div class="shell-nav"><a href="../">All Tools</a></div>
  </nav>
  <section class="hero">
    <div>
      <div class="eyebrow">Tool Type</div>
      <h1>Tool Name</h1>
      <p class="lede">One direct sentence about the workflow it serves.</p>
    </div>
  </section>
  <!-- Tool UI here -->
</main>
```

Root-level tools should use `assets/tool-shell.css`; nested tools should use `../assets/tool-shell.css`.

## Publish Preflight

Run this before pushing public catalog changes:

```powershell
node scripts/generate-index.js --check --json
node scripts/public-preflight.js --json
```

`scripts/public-tools.js` is the explicit public catalog allowlist. Add new public tools there first, then let the index and preflight read the same source of truth.
