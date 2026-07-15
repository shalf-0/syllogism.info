#!/usr/bin/env node
// Zero-dependency static site builder for syllogism.info.
// Reads data/arguments.json, validates it, and writes the site to dist/.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const DATA_FILE = path.join(ROOT, "data", "arguments.json");

// ---------------------------------------------------------------------------
// Load & validate
// ---------------------------------------------------------------------------

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const claims = data.claims || {};
const args = data.arguments || {};
const site = data.site || { title: "syllogism.info", tagline: "", description: "" };

const errors = [];
const warnings = [];

for (const [id, claim] of Object.entries(claims)) {
  if (!claim.text) errors.push(`claim "${id}": missing text`);
  if (claim.negation) {
    if (!claims[claim.negation]) {
      errors.push(`claim "${id}": negation "${claim.negation}" does not exist`);
    } else if (claims[claim.negation].negation !== id) {
      warnings.push(`claim "${id}": negation "${claim.negation}" does not point back`);
    }
  }
}

for (const [id, arg] of Object.entries(args)) {
  if (!arg.title) errors.push(`argument "${id}": missing title`);
  if (!Array.isArray(arg.steps) || arg.steps.length === 0) {
    errors.push(`argument "${id}": needs at least one step`);
    continue;
  }
  arg.steps.forEach((step, i) => {
    if (!claims[step.claim]) {
      errors.push(`argument "${id}" step ${i + 1}: unknown claim "${step.claim}"`);
    }
    if (step.from) {
      for (const n of step.from) {
        if (!Number.isInteger(n) || n < 1 || n > i) {
          errors.push(`argument "${id}" step ${i + 1}: "from" reference ${n} is not an earlier step`);
        }
      }
    }
  });
  const last = arg.steps[arg.steps.length - 1];
  if (!last.from) {
    warnings.push(`argument "${id}": final step is not inferred (no "from") — is it really an argument?`);
  }
}

if (errors.length) {
  console.error("Data validation failed:\n" + errors.map((e) => "  ✗ " + e).join("\n"));
  process.exit(1);
}
warnings.forEach((w) => console.warn("  ⚠ " + w));

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

const argsFor = {}; // claimId -> [argId] (arguments whose final conclusion is the claim)
const usedIn = {}; // claimId -> [{argId, step, inferred}] (claim appears as a non-final step)
const derived = {}; // claimId -> true (claim is inferred mid-argument somewhere)

for (const [id, arg] of Object.entries(args)) {
  const finalClaim = arg.steps[arg.steps.length - 1].claim;
  (argsFor[finalClaim] = argsFor[finalClaim] || []).push(id);
  arg.steps.slice(0, -1).forEach((step, i) => {
    (usedIn[step.claim] = usedIn[step.claim] || []).push({ argId: id, step: i + 1, inferred: !!step.from });
    if (step.from) derived[step.claim] = true;
  });
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const claimUrl = (id) => `/c/${id}/`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="76" font-size="78" text-anchor="middle" font-family="Georgia,serif">∴</text></svg>'
  );

function page({ title, heading, content, pathToRoot = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(site.description)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="masthead">
  <a class="wordmark" href="/"><span class="therefore-mark">∴</span> ${esc(site.title)}</a>
  <span class="tagline">${esc(site.tagline)}</span>
  <nav class="site-nav"><a href="/graph/">graph</a></nav>
</header>
<main>
${content}
</main>
<footer>
  <p>${esc(site.description)}</p>
  <p><a href="/">All claims</a> · <a href="/graph/">Graph</a> · <a href="/admin/">Edit this site</a></p>
</footer>
</body>
</html>`;
}

function renderCitation(src) {
  if (!src) return "";
  const bits = [];
  if (src.authors) bits.push(esc(src.authors));
  if (src.title) bits.push(`&ldquo;${esc(src.title)}&rdquo;`);
  if (src.container) bits.push(`<i>${esc(src.container)}</i>`);
  if (src.publisher) bits.push(esc(src.publisher));
  if (src.year) bits.push(esc(src.year));
  let html = bits.join(", ") + ".";
  if (src.url) html += ` <a href="${esc(src.url)}" rel="noopener">${esc(src.url.replace(/^https?:\/\//, ""))}</a>`;
  return html;
}

function renderArgument(argId, currentClaimId) {
  const arg = args[argId];
  const steps = arg.steps
    .map((step, i) => {
      const claim = claims[step.claim];
      const isSelf = step.claim === currentClaimId;
      const link = `<a class="claim-link${isSelf ? " self" : ""}" href="${claimUrl(step.claim)}">${esc(claim.text)}</a>`;
      if (step.from) {
        const from = `<span class="from">from ${step.from.join(", ")}</span>`;
        return `  <li class="inference"><span class="tf">∴</span> ${link}. ${from}</li>`;
      }
      return `  <li class="premise">${link}.</li>`;
    })
    .join("\n");
  const notes = arg.notes ? `<p class="notes">${esc(arg.notes)}</p>` : "";
  return `<article class="tile" id="arg-${esc(argId)}">
<h3>${esc(arg.title)}</h3>
<ol class="steps">
${steps}
</ol>
${notes}
<p class="cite">${renderCitation(arg.source)}</p>
</article>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// Claim pages
for (const [id, claim] of Object.entries(claims)) {
  const forIds = argsFor[id] || [];
  const neg = claim.negation && claims[claim.negation] ? claim.negation : null;
  const againstCount = neg ? (argsFor[neg] || []).length : 0;

  let content = `<p class="crumb"><a href="/">← all claims</a></p>\n`;
  content += `<h1 class="claim-title">${esc(claim.text)}</h1>\n`;
  if (claim.notes) content += `<p class="claim-notes">${esc(claim.notes)}</p>\n`;

  content += `<section>\n<h2>Arguments for this claim</h2>\n`;
  if (forIds.length) {
    content += `<div class="tiles">\n${forIds.map((a) => renderArgument(a, id)).join("\n")}\n</div>\n`;
  } else if (derived[id]) {
    content += `<p class="empty">No standalone arguments recorded yet, but this claim is <strong>derived as an intermediate conclusion</strong> inside the arguments listed below.</p>\n`;
  } else {
    content += `<p class="empty">No arguments recorded yet — this is currently a <strong>root claim</strong> of the graph.</p>\n`;
  }
  content += `</section>\n`;

  if (neg) {
    content += `<section>\n<h2>Arguments against</h2>\n<p class="empty">This claim is the negation of <a href="${claimUrl(neg)}">${esc(
      claims[neg].text
    )}</a>, which has ${againstCount} argument${againstCount === 1 ? "" : "s"} for it.</p>\n</section>\n`;
  }

  const uses = usedIn[id] || [];
  if (uses.length) {
    const items = uses
      .map(({ argId, step, inferred }) => {
        const concl = args[argId].steps[args[argId].steps.length - 1].claim;
        const role = inferred ? "derived at step" : "premise";
        return `  <li><a href="${claimUrl(concl)}#arg-${esc(argId)}">${esc(args[argId].title)}</a> <span class="from">(${role} ${step}, an argument for &ldquo;${esc(
          claims[concl].text
        )}&rdquo;)</span></li>`;
      })
      .join("\n");
    content += `<section>\n<h2>Appears as a step in</h2>\n<ul class="uses">\n${items}\n</ul>\n</section>\n`;
  }

  const dir = path.join(DIST, "c", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    page({ title: `${claim.text} — ${site.title}`, content })
  );
}

// Index page
{
  const featured = Object.entries(claims).filter(([, c]) => c.featured);
  const featuredCards = featured
    .map(([id, c]) => {
      const n = (argsFor[id] || []).length;
      return `  <a class="tile card" href="${claimUrl(id)}">
    <h3>${esc(c.text)}</h3>
    <p class="count">${n} argument${n === 1 ? "" : "s"}</p>
  </a>`;
    })
    .join("\n");

  const rows = Object.entries(claims)
    .sort((a, b) => a[1].text.localeCompare(b[1].text))
    .map(([id, c]) => {
      const n = (argsFor[id] || []).length;
      const badge = n
        ? `<span class="count">${n} argument${n === 1 ? "" : "s"}</span>`
        : derived[id]
          ? `<span class="count root">derived claim</span>`
          : `<span class="count root">root claim</span>`;
      return `  <li><a href="${claimUrl(id)}">${esc(c.text)}</a> ${badge}</li>`;
    })
    .join("\n");

  const content = `<p class="lede">${esc(site.description)}</p>
<p class="lede-link"><a href="/graph/">Explore the full argument graph →</a></p>
<section>
<h2>The big questions</h2>
<div class="tiles">
${featuredCards}
</div>
</section>
<section>
<h2>All claims</h2>
<ul class="claim-index">
${rows}
</ul>
</section>`;

  fs.writeFileSync(
    path.join(DIST, "index.html"),
    page({ title: `${site.title} — ${site.tagline}`, content })
  );
}

// Static assets
fs.copyFileSync(path.join(ROOT, "assets", "style.css"), path.join(DIST, "style.css"));
fs.mkdirSync(path.join(DIST, "admin"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "assets", "admin.html"), path.join(DIST, "admin", "index.html"));
fs.copyFileSync(path.join(ROOT, "assets", "admin.js"), path.join(DIST, "admin", "admin.js"));
fs.mkdirSync(path.join(DIST, "graph"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "assets", "graph.html"), path.join(DIST, "graph", "index.html"));
fs.copyFileSync(path.join(ROOT, "assets", "graph.js"), path.join(DIST, "graph", "graph.js"));
fs.copyFileSync(DATA_FILE, path.join(DIST, "data.json"));
if (fs.existsSync(path.join(ROOT, "CNAME"))) {
  fs.copyFileSync(path.join(ROOT, "CNAME"), path.join(DIST, "CNAME"));
}
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

const nClaims = Object.keys(claims).length;
const nArgs = Object.keys(args).length;
const nRoots = Object.keys(claims).filter((id) => !(argsFor[id] || []).length).length;
console.log(`Built ${nClaims} claim pages, ${nArgs} arguments (${nRoots} root claims) → dist/`);
