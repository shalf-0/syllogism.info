# syllogism.info

A map of arguments in analytic philosophy. Every argument is a tile: numbered
premises, inferred steps marked with ∴, and a citation to a related paper. Every
premise is itself a *claim* with its own page listing the arguments for **it** —
so you can click your way down the graph until you hit the root premises.

The whole site is generated from one data file, **`data/arguments.json`**, by a
single zero-dependency Node script, **`build.js`**.

## Editing the site

All content lives in `data/arguments.json`. Edit it and push — the GitHub
Action rebuilds and redeploys in about a minute.

- **On GitHub** — edit `data/arguments.json` directly in the github.com web UI
  and commit. Simplest for a quick addition.
- **Locally** — edit the file, run `node build.js` to validate and preview
  (`python3 -m http.server -d dist`), then commit and push.

The build fails loudly on dangling references, so a typo'd claim id can't
silently break the site.

## Data model

`data/arguments.json` has two tables:

### `claims`

Every premise and every conclusion is a claim, keyed by a permanent slug id:

```json
"universe-began": {
  "text": "The universe began to exist",
  "negation": "some-claim-id",   // optional — links the "arguments against" section
  "featured": true,              // optional — shows on the home page as a big question
  "notes": "…"                   // optional — shown under the claim heading
}
```

A claim with no arguments concluding in it is automatically labelled a **root
claim**.

### `arguments`

An argument is an ordered list of steps, each referencing a claim. A step with
a `from` array is an inference from those earlier step numbers; a step without
one is a premise. **The last step is the claim the argument is for**, and the
argument appears on that claim's page.

```json
"kalam": {
  "title": "The Kalam Cosmological Argument",
  "steps": [
    { "claim": "causal-principle" },
    { "claim": "universe-began" },
    { "claim": "universe-caused", "from": [1, 2] },
    { "claim": "kalam-bridge" },
    { "claim": "god-exists", "from": [3, 4] }
  ],
  "source": {
    "authors": "William Lane Craig & James D. Sinclair",
    "year": 2009,
    "title": "The Kalam Cosmological Argument",
    "container": "The Blackwell Companion to Natural Theology, ed. …",
    "publisher": "Wiley-Blackwell",
    "url": "https://doi.org/…"
  },
  "notes": "Optional gloss shown on the tile."
}
```

Intermediate conclusions (like "The universe has a cause") are ordinary claims,
so they get pages too — and other arguments can build on them.

## One-time deployment setup

1. Merge to `main`. The GitHub Action in `.github/workflows/deploy.yml` builds
   and deploys on every push.
2. In the repository settings: **Settings → Pages → Source → GitHub Actions**.
3. Custom domain: in **Settings → Pages** set the custom domain to
   `syllogism.info` (the `CNAME` file in this repo matches). At your DNS
   provider, point the apex domain at GitHub Pages with A records:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   (and optionally AAAA records `2606:50c0:8000::153` … `8003::153`).
   Enable **Enforce HTTPS** once the certificate is issued.
