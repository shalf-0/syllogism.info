// syllogism.info admin editor — commits data/arguments.json to GitHub via the contents API.
"use strict";

const DATA_PATH = "data/arguments.json";
const LS_KEY = "syllogism-admin-config";

let state = {
  data: null, // parsed arguments.json
  sha: null, // blob sha needed for the update commit
  dirty: false,
  currentArg: null,
  currentClaim: null,
};

const $ = (id) => document.getElementById(id);

// --- config -----------------------------------------------------------------

function loadConfig() {
  let cfg = { owner: "shalf-0", repo: "syllogism.info", branch: "main", token: "" };
  try {
    cfg = { ...cfg, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
  } catch (e) {}
  $("cfg-owner").value = cfg.owner;
  $("cfg-repo").value = cfg.repo;
  $("cfg-branch").value = cfg.branch;
  $("cfg-token").value = cfg.token;
  return cfg;
}

function saveConfig() {
  const cfg = {
    owner: $("cfg-owner").value.trim(),
    repo: $("cfg-repo").value.trim(),
    branch: $("cfg-branch").value.trim() || "main",
    token: $("cfg-token").value.trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  return cfg;
}

// --- helpers ----------------------------------------------------------------

function status(msg, cls) {
  const el = $("status");
  el.textContent = msg;
  el.className = cls || "";
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function serialize() {
  return JSON.stringify(state.data, null, 2) + "\n";
}

function api(path, opts = {}) {
  const cfg = saveConfig();
  const headers = { Accept: "application/vnd.github+json", ...opts.headers };
  if (cfg.token) headers.Authorization = "Bearer " + cfg.token;
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`, { ...opts, headers });
}

// --- load & commit ----------------------------------------------------------

async function loadData() {
  const cfg = saveConfig();
  status("Loading…");
  try {
    const res = await api(`contents/${DATA_PATH}?ref=${encodeURIComponent(cfg.branch)}`);
    if (!res.ok) throw new Error(`GitHub responded ${res.status} — check owner/repo/branch (and token for private repos)`);
    const body = await res.json();
    state.data = JSON.parse(b64decode(body.content));
    state.sha = body.sha;
    state.dirty = false;
    state.data.claims = state.data.claims || {};
    state.data.arguments = state.data.arguments || {};
    $("editor").hidden = false;
    renderLists();
    status(
      `Loaded ${Object.keys(state.data.claims).length} claims and ${Object.keys(state.data.arguments).length} arguments from ${cfg.owner}/${cfg.repo}@${cfg.branch}.`,
      "ok"
    );
  } catch (e) {
    status("Load failed: " + e.message, "err");
  }
}

async function commit() {
  const cfg = saveConfig();
  if (!state.data) return;
  if (!cfg.token) return status("A token with Contents: read & write is required to commit.", "err");
  const msg = $("commit-msg").value.trim() || "Update arguments";
  status("Committing…");
  try {
    const res = await api(`contents/${DATA_PATH}`, {
      method: "PUT",
      body: JSON.stringify({
        message: msg,
        content: b64encode(serialize()),
        sha: state.sha,
        branch: cfg.branch,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || `GitHub responded ${res.status}`);
    state.sha = body.content.sha;
    state.dirty = false;
    status(`Committed ${body.commit.sha.slice(0, 7)} — the site will rebuild and go live in about a minute.`, "ok");
    $("commit-msg").value = "";
  } catch (e) {
    status("Commit failed: " + e.message, "err");
  }
}

function download() {
  const blob = new Blob([serialize()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "arguments.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- rendering --------------------------------------------------------------

function renderLists() {
  const claims = state.data.claims;
  const args = state.data.arguments;

  const argList = $("arg-list");
  argList.innerHTML = "";
  for (const [id, arg] of Object.entries(args)) {
    const concl = arg.steps?.length ? claims[arg.steps[arg.steps.length - 1].claim]?.text : "?";
    const b = document.createElement("button");
    b.innerHTML = `<strong></strong><span class="sub"></span>`;
    b.querySelector("strong").textContent = arg.title || id;
    b.querySelector(".sub").textContent = "∴ " + (concl || "?");
    if (id === state.currentArg) b.classList.add("active");
    b.onclick = () => editArgument(id);
    argList.appendChild(b);
  }

  const claimList = $("claim-list");
  claimList.innerHTML = "";
  for (const [id, c] of Object.entries(claims)) {
    const b = document.createElement("button");
    b.innerHTML = `<span></span><span class="sub"></span>`;
    b.querySelector("span").textContent = c.text || id;
    b.querySelector(".sub").textContent = id + (c.featured ? " · featured" : "");
    if (id === state.currentClaim) b.classList.add("active");
    b.onclick = () => editClaim(id);
    claimList.appendChild(b);
  }

  const dl = $("claim-ids");
  dl.innerHTML = "";
  for (const [id, c] of Object.entries(claims)) {
    const o = document.createElement("option");
    o.value = id;
    o.label = c.text;
    dl.appendChild(o);
  }

  $("json-text").value = serialize();
}

// --- argument form ----------------------------------------------------------

function stepRow(step) {
  const row = document.createElement("div");
  row.className = "step-row";
  row.innerHTML = `
    <div>
      <input type="text" class="step-claim" list="claim-ids" placeholder="claim id">
      <p class="claimtext"></p>
      <div class="newclaim" hidden>
        <input type="text" class="step-newtext" placeholder="Text for this new claim — it will be created on save">
      </div>
    </div>
    <input type="text" class="step-from" placeholder="from (1, 2)">
    <button class="small danger" title="remove step">✕</button>`;
  const claimInput = row.querySelector(".step-claim");
  const fromInput = row.querySelector(".step-from");
  claimInput.value = step?.claim || "";
  fromInput.value = step?.from ? step.from.join(", ") : "";
  const refresh = () => {
    const c = state.data.claims[claimInput.value.trim()];
    row.querySelector(".claimtext").textContent = c ? c.text : "";
    row.querySelector(".newclaim").hidden = !claimInput.value.trim() || !!c;
  };
  claimInput.addEventListener("input", refresh);
  row.querySelector("button").onclick = () => row.remove();
  refresh();
  return row;
}

function editArgument(id) {
  state.currentArg = id;
  const arg = id ? state.data.arguments[id] : { title: "", steps: [{}, {}, { from: [1, 2] }], source: {}, notes: "" };
  $("arg-form").hidden = false;
  $("arg-form-title").textContent = id ? `Edit: ${arg.title}` : "New argument";
  $("arg-id").value = id || "";
  $("arg-id").disabled = !!id;
  $("arg-title").value = arg.title || "";
  $("src-authors").value = arg.source?.authors || "";
  $("src-year").value = arg.source?.year || "";
  $("src-title").value = arg.source?.title || "";
  $("src-container").value = arg.source?.container || "";
  $("src-publisher").value = arg.source?.publisher || "";
  $("src-url").value = arg.source?.url || "";
  $("arg-notes").value = arg.notes || "";
  const steps = $("steps");
  steps.innerHTML = "";
  (arg.steps || []).forEach((s) => steps.appendChild(stepRow(s)));
  renderLists();
}

function saveArgument() {
  const id = $("arg-id").disabled ? state.currentArg : slugify($("arg-id").value || $("arg-title").value);
  if (!id) return status("The argument needs an id.", "err");
  const title = $("arg-title").value.trim();
  if (!title) return status("The argument needs a title.", "err");

  const steps = [];
  for (const row of $("steps").querySelectorAll(".step-row")) {
    const claimId = row.querySelector(".step-claim").value.trim();
    if (!claimId) continue;
    if (!state.data.claims[claimId]) {
      const text = row.querySelector(".step-newtext").value.trim();
      if (!text) return status(`Step claim "${claimId}" doesn't exist — give it a text to create it.`, "err");
      state.data.claims[claimId] = { text };
    }
    const step = { claim: claimId };
    const from = row.querySelector(".step-from").value.trim();
    if (from) {
      step.from = from.split(/[,\s]+/).filter(Boolean).map(Number);
      if (step.from.some((n) => !Number.isInteger(n) || n < 1 || n > steps.length)) {
        return status(`Step ${steps.length + 1}: "from" must reference earlier step numbers.`, "err");
      }
    }
    steps.push(step);
  }
  if (steps.length < 2) return status("An argument needs at least two steps.", "err");

  const source = {
    authors: $("src-authors").value.trim(),
    year: Number($("src-year").value) || undefined,
    title: $("src-title").value.trim(),
    container: $("src-container").value.trim(),
    publisher: $("src-publisher").value.trim(),
    url: $("src-url").value.trim() || undefined,
  };
  Object.keys(source).forEach((k) => source[k] === "" || source[k] === undefined ? delete source[k] : null);

  state.data.arguments[id] = { title, steps, source, notes: $("arg-notes").value.trim() || undefined };
  if (!state.data.arguments[id].notes) delete state.data.arguments[id].notes;
  state.currentArg = id;
  state.dirty = true;
  $("arg-id").disabled = true;
  renderLists();
  status(`Saved argument "${title}" locally — use Publish to commit.`, "ok");
}

function deleteArgument() {
  const id = state.currentArg;
  if (!id || !state.data.arguments[id]) return;
  if (!confirm(`Delete argument "${state.data.arguments[id].title}"?`)) return;
  delete state.data.arguments[id];
  state.currentArg = null;
  state.dirty = true;
  $("arg-form").hidden = true;
  renderLists();
  status("Argument deleted locally — use Publish to commit.", "ok");
}

// --- claim form -------------------------------------------------------------

function editClaim(id) {
  state.currentClaim = id;
  const c = id ? state.data.claims[id] : { text: "" };
  $("claim-form").hidden = false;
  $("claim-form-title").textContent = id ? `Edit: ${id}` : "New claim";
  $("claim-id").value = id || "";
  $("claim-id").disabled = !!id;
  $("claim-text").value = c.text || "";
  $("claim-negation").value = c.negation || "";
  $("claim-featured").checked = !!c.featured;
  $("claim-notes").value = c.notes || "";
  renderLists();
}

function saveClaim() {
  const id = $("claim-id").disabled ? state.currentClaim : slugify($("claim-id").value || $("claim-text").value);
  if (!id) return status("The claim needs an id.", "err");
  const text = $("claim-text").value.trim();
  if (!text) return status("The claim needs a text.", "err");
  const negation = $("claim-negation").value.trim();
  if (negation && !state.data.claims[negation]) {
    return status(`Negation "${negation}" is not an existing claim id.`, "err");
  }
  const c = { text };
  if (negation) c.negation = negation;
  if ($("claim-featured").checked) c.featured = true;
  const notes = $("claim-notes").value.trim();
  if (notes) c.notes = notes;
  state.data.claims[id] = c;
  if (negation && !state.data.claims[negation].negation) {
    state.data.claims[negation].negation = id; // keep negations symmetric
  }
  state.currentClaim = id;
  state.dirty = true;
  $("claim-id").disabled = true;
  renderLists();
  status(`Saved claim "${id}" locally — use Publish to commit.`, "ok");
}

function deleteClaim() {
  const id = state.currentClaim;
  if (!id || !state.data.claims[id]) return;
  const refs = [];
  for (const [aid, arg] of Object.entries(state.data.arguments)) {
    if ((arg.steps || []).some((s) => s.claim === id)) refs.push(arg.title || aid);
  }
  for (const [cid, c] of Object.entries(state.data.claims)) {
    if (c.negation === id) refs.push(`negation of "${cid}"`);
  }
  if (refs.length) return status(`Cannot delete: still referenced by ${refs.join("; ")}.`, "err");
  if (!confirm(`Delete claim "${id}"?`)) return;
  delete state.data.claims[id];
  state.currentClaim = null;
  state.dirty = true;
  $("claim-form").hidden = true;
  renderLists();
  status("Claim deleted locally — use Publish to commit.", "ok");
}

// --- tabs & wiring ----------------------------------------------------------

function showTab(name) {
  for (const t of ["arguments", "claims", "json"]) {
    $(`view-${t}`).hidden = t !== name;
    $(`tab-${t}`).classList.toggle("active", t === name);
  }
}

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

loadConfig();
$("btn-load").onclick = loadData;
$("btn-commit").onclick = commit;
$("btn-download").onclick = download;
$("btn-new-arg").onclick = () => editArgument(null);
$("btn-new-claim").onclick = () => editClaim(null);
$("btn-save-arg").onclick = saveArgument;
$("btn-del-arg").onclick = deleteArgument;
$("btn-save-claim").onclick = saveClaim;
$("btn-del-claim").onclick = deleteClaim;
$("btn-add-step").onclick = () => $("steps").appendChild(stepRow(null));
$("tab-arguments").onclick = () => showTab("arguments");
$("tab-claims").onclick = () => showTab("claims");
$("tab-json").onclick = () => showTab("json");
$("btn-apply-json").onclick = () => {
  try {
    state.data = JSON.parse($("json-text").value);
    state.dirty = true;
    renderLists();
    status("JSON applied locally — use Publish to commit.", "ok");
  } catch (e) {
    status("Invalid JSON: " + e.message, "err");
  }
};
