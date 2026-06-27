// ═══════════════════════════════════════════════════════════════════════════
//  iIrys Frame — dashboard logic
// ═══════════════════════════════════════════════════════════════════════════

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  network: "devnet",
  status: null,
  assets: [],
  stats: { count: 0, totalBytes: 0, collections: 0 },
  queue: [], // { id, file, size, quote, status }
  filter: { text: "", chip: null },
};

let qid = 0;

// ── tiny helpers ────────────────────────────────────────────────────────────
function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KiB", "MiB", "GiB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function trunc(s, head = 6, tail = 4) {
  if (!s) return "—";
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function isImage(ct) { return (ct || "").startsWith("image/"); }

function toast(msg, kind = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast is-show ${kind === "ok" ? "is-ok" : kind === "err" ? "is-err" : ""}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = "toast"), 3200);
}

async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label, "ok"); }
  catch { toast("Copy failed", "err"); }
}

// ── api ───────────────────────────────────────────────────────────────────--
function authHeaders() {
  const h = {};
  if (state.config?.authRequired) {
    const t = $("#tokenInput").value.trim();
    if (t) h["x-vault-token"] = t;
  }
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let json;
  try { json = await res.json(); } catch { json = { ok: false, error: `HTTP ${res.status}` }; }
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ── bootstrap ────────────────────────────────────────────────────────────--
async function boot() {
  try {
    state.config = await api("/api/config");
  } catch (e) {
    toast("Backend unreachable — is the server running?", "err");
    return;
  }
  state.network = state.config.defaultNetwork || "devnet";
  $("#freeHint").textContent = `<${fmtBytes(state.config.freeThresholdBytes)} free`;
  if (state.config.authRequired) $("#tokenInput").hidden = false;

  wire();
  applyNetworkUI();
  addAttrRow();
  await Promise.all([refreshStatus(), refreshAssets()]);
  updateSeal(); // reflect read-only / connected state on the seal button at rest
}

// ── network ──────────────────────────────────────────────────────────────--
function applyNetworkUI() {
  const isMain = state.network === "mainnet";
  $("#netToggle").classList.toggle("is-mainnet", isMain);
  $$("#netToggle .net-toggle__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.net === state.network));
  $("#statNet").textContent = isMain ? "Mainnet" : "Devnet";
  $("#statNetSub").textContent = isMain ? "permanent" : "~60-day retention";
}

async function setNetwork(net) {
  if (net === state.network) return;
  state.network = net;
  applyNetworkUI();
  await refreshStatus();
  reprice(); // requote queued files on the new network
}

// ── status ───────────────────────────────────────────────────────────────--
async function refreshStatus() {
  try {
    const { status } = await api(`/api/status?network=${state.network}`);
    state.status = status;
    const live = status.connected;
    $("#walletDot").classList.toggle("is-live", live);
    $("#walletAddr").textContent = live ? trunc(status.address) : "read-only";
    $("#walletBal").textContent = live ? `${(+status.balance).toPrecision(4)} ${tokenSym()}` : "no key";
    $("#statBalance").textContent = live ? (+status.balance).toPrecision(4) : "—";
    $("#statBalanceSub").textContent = live ? tokenSym() : "read-only mode";
    $("#fundBtn").disabled = !live;
  } catch (e) {
    toast(`Status: ${e.message}`, "err");
  }
}
function tokenSym() {
  return state.network === "mainnet" ? "ETH" : "tETH";
}

// ── assets / vault ──────────────────────────────────────────────────────────
async function refreshAssets() {
  try {
    const { assets, stats } = await api("/api/assets");
    state.assets = assets;
    state.stats = stats;
    $("#statAssets").textContent = stats.count;
    $("#statSize").textContent = fmtBytes(stats.totalBytes);
    renderChips();
    renderVault();
  } catch (e) {
    toast(`Vault: ${e.message}`, "err");
  }
}

function renderChips() {
  const byTier = {};
  state.assets.forEach((a) => { if (a.tier) byTier[a.tier] = (byTier[a.tier] || 0) + 1; });
  const tiers = Object.keys(byTier);
  const wrap = $("#chips");
  if (!tiers.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = [`<button class="chip ${!state.filter.chip ? "is-active" : ""}" data-chip="">All<span class="chip__count">${state.assets.length}</span></button>`]
    .concat(tiers.map((t) => `<button class="chip ${state.filter.chip === t ? "is-active" : ""}" data-chip="${esc(t)}">${esc(t)}<span class="chip__count">${byTier[t]}</span></button>`))
    .join("");
  $$("#chips .chip").forEach((c) => c.onclick = () => { state.filter.chip = c.dataset.chip || null; renderChips(); renderVault(); });
}

function filteredAssets() {
  const q = state.filter.text.toLowerCase();
  return state.assets.filter((a) => {
    if (state.filter.chip && a.tier !== state.filter.chip) return false;
    if (!q) return true;
    return [a.name, a.id, a.collection].some((v) => (v || "").toLowerCase().includes(q));
  });
}

function renderVault() {
  const grid = $("#vaultGrid");
  const list = filteredAssets();
  $("#emptyState").style.display = list.length ? "none" : "block";
  grid.innerHTML = list.map((a, i) => {
    const tier = a.tier ? `<span class="card__tier tier-${esc(a.tier)}">${esc(a.tier)}</span>` : "";
    const media = isImage(a.contentType)
      ? `<img loading="lazy" src="${esc(a.url)}" alt="${esc(a.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card__glyph',textContent:'image\\nunavailable'}))" />`
      : `<div class="card__glyph">${esc((a.contentType || "file").split("/")[1] || "file").toUpperCase()}</div>`;
    return `<div class="card" data-idx="${i}">
      <div class="card__media">${tier}${media}</div>
      <div class="card__body">
        <span class="card__name">${esc(a.name)}</span>
        <span class="card__sub"><span>${fmtBytes(a.size)}</span><span>${trunc(a.id, 5, 4)}</span></span>
      </div>
    </div>`;
  }).join("");
  $$("#vaultGrid .card").forEach((c) => c.onclick = () => openDrawer(list[+c.dataset.idx]));
}

// ── drawer ───────────────────────────────────────────────────────────────--
function openDrawer(a) {
  if (!a) return;
  const media = isImage(a.contentType)
    ? `<img src="${esc(a.url)}" alt="${esc(a.name)}" />`
    : `<div class="card__glyph">${esc(a.contentType || "file")}</div>`;
  const tagRows = (a.tags || []).map((t) => `<span class="dd__tag">${esc(t.name)}: ${esc(t.value)}</span>`).join("");
  $("#drawerPanel").innerHTML = `
    <button class="dd__close" id="ddClose">✕</button>
    <div class="dd__media">${media}</div>
    <div class="dd__title">${esc(a.name)}</div>
    <div class="dd__meta">${fmtBytes(a.size)} · ${esc(a.contentType)} · ${esc(a.network)}${a.collection ? " · " + esc(a.collection) : ""}</div>
    <div class="dd__actions">
      <a class="btn btn--ghost btn--mini" href="${esc(a.url)}" target="_blank" rel="noopener">Open ↗</a>
      <button class="btn btn--mini" id="ddUseImg">Use as metadata image</button>
    </div>
    <div class="dd__row"><span>Gateway URL</span>${copyField(a.url)}</div>
    <div class="dd__row"><span>Mutable URL</span>${copyField(a.mutableUrl)}</div>
    <div class="dd__row"><span>Transaction ID</span>${copyField(a.id)}</div>
    <div class="dd__row"><span>Tags</span><div class="dd__tags">${tagRows}</div></div>`;
  $("#drawer").classList.add("is-open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#ddClose").onclick = closeDrawer;
  $("#ddUseImg").onclick = () => { $("#metaImage").value = a.url; $("#metaName").value ||= a.name; closeDrawer(); toast("Image set on metadata", "ok"); };
  $$("#drawerPanel .copyfield button").forEach((b) => b.onclick = () => copy(b.dataset.copy));
}
function copyField(v) {
  return `<div class="copyfield"><code>${esc(v)}</code><button data-copy="${esc(v)}">Copy</button></div>`;
}
function closeDrawer() {
  $("#drawer").classList.remove("is-open");
  $("#drawer").setAttribute("aria-hidden", "true");
}

// ── upload queue ────────────────────────────────────────────────────────────
function addFiles(files) {
  for (const file of files) {
    const item = { id: ++qid, file, size: file.size, quote: null, status: "queued", thumb: null };
    if (file.type.startsWith("image/")) item.thumb = URL.createObjectURL(file);
    state.queue.push(item);
    quote(item);
  }
  renderQueue();
}

async function quote(item) {
  try {
    const { quote } = await api(`/api/price?network=${state.network}&bytes=${item.size}`);
    item.quote = quote;
  } catch { item.quote = null; }
  renderQueue();
}
function reprice() { state.queue.filter((i) => i.status === "queued").forEach(quote); }

function renderQueue() {
  const q = $("#queue");
  q.innerHTML = state.queue.map((it) => {
    const cost = it.status === "done" ? `<span class="qitem__cost cost--free">sealed ✓</span>`
      : it.status === "error" ? `<span class="qitem__cost cost--paid">failed</span>`
      : it.status === "uploading" ? `<span class="qitem__cost cost--wait">sealing…</span>`
      : !it.quote ? `<span class="qitem__cost cost--wait">…</span>`
      : it.quote.free ? `<span class="qitem__cost cost--free">FREE</span>`
      : `<span class="qitem__cost cost--paid">${(+it.quote.price).toPrecision(3)} ${tokenSym()}</span>`;
    const thumb = it.thumb ? `<img src="${it.thumb}" alt="" />` : "◈";
    return `<div class="qitem ${it.status === "done" ? "is-done" : it.status === "error" ? "is-error" : ""}">
      <div class="qitem__thumb">${thumb}</div>
      <div class="qitem__meta"><div class="qitem__name">${esc(it.file.name)}</div><div class="qitem__size">${fmtBytes(it.size)}</div></div>
      <div style="display:flex;align-items:center;gap:8px">${cost}<button class="qitem__x" data-x="${it.id}" title="Remove">✕</button></div>
    </div>`;
  }).join("");
  $$("#queue .qitem__x").forEach((b) => b.onclick = () => {
    state.queue = state.queue.filter((i) => i.id !== +b.dataset.x);
    renderQueue(); updateSeal();
  });
  updateSeal();
}
function updateSeal() {
  const pending = state.queue.filter((i) => i.status === "queued").length;
  const btn = $("#sealBtn");
  btn.disabled = pending === 0 || !state.status?.connected;
  btn.textContent = state.status?.connected
    ? (pending ? `Seal ${pending} to Irys` : "Seal to Irys")
    : "Connect a key to seal";
}

async function sealAll() {
  const pending = state.queue.filter((i) => i.status === "queued");
  if (!pending.length) return;
  $("#sealBtn").disabled = true;
  let ok = 0;
  for (const it of pending) {
    it.status = "uploading"; renderQueue();
    try {
      const fd = new FormData();
      fd.append("file", it.file);
      fd.append("network", state.network);
      fd.append("name", it.file.name);
      if ($("#collectionInput").value) fd.append("collection", $("#collectionInput").value.trim());
      if ($("#tierSelect").value) fd.append("tier", $("#tierSelect").value);
      await api("/api/upload", { method: "POST", headers: authHeaders(), body: fd });
      it.status = "done"; ok++;
    } catch (e) {
      it.status = "error"; toast(`Seal failed: ${e.message}`, "err");
    }
    renderQueue();
  }
  if (ok) { toast(`Sealed ${ok} asset${ok > 1 ? "s" : ""} forever`, "ok"); await Promise.all([refreshAssets(), refreshStatus()]); }
  // clear the done ones after a beat
  setTimeout(() => { state.queue = state.queue.filter((i) => i.status !== "done"); renderQueue(); }, 1400);
}

// ── metadata ────────────────────────────────────────────────────────────────
function addAttrRow(trait = "", value = "") {
  const row = document.createElement("div");
  row.className = "attr-row";
  row.innerHTML = `<input placeholder="trait_type" value="${esc(trait)}" /><input placeholder="value" value="${esc(value)}" /><button type="button" title="Remove">✕</button>`;
  row.querySelector("button").onclick = () => row.remove();
  $("#attrRows").appendChild(row);
}
function collectAttrs() {
  return $$("#attrRows .attr-row").map((r) => {
    const [t, v] = $$("input", r);
    return { trait_type: t.value.trim(), value: v.value.trim() };
  }).filter((a) => a.trait_type && a.value !== "");
}
async function uploadMeta() {
  const name = $("#metaName").value.trim();
  const image = $("#metaImage").value.trim();
  if (!name || !image) return toast("Name and image URL are required", "err");
  $("#metaBtn").disabled = true;
  try {
    const body = {
      network: state.network, name, image,
      description: $("#metaDesc").value.trim(),
      tier: $("#tierSelect").value || undefined,
      collection: $("#collectionInput").value.trim() || undefined,
      attributes: collectAttrs(),
    };
    const { asset } = await api("/api/metadata", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    toast("Metadata sealed", "ok");
    await copy(asset.url, "Metadata URL copied");
    await Promise.all([refreshAssets(), refreshStatus()]);
  } catch (e) {
    toast(`Metadata: ${e.message}`, "err");
  } finally { $("#metaBtn").disabled = false; }
}

// ── fund ─────────────────────────────────────────────────────────────────--
function openFund() {
  $("#fundAmount").value = "";
  $("#fundModal").classList.add("is-open");
  $("#fundModal").setAttribute("aria-hidden", "false");
  setTimeout(() => $("#fundAmount").focus(), 50);
}
function closeFund() { $("#fundModal").classList.remove("is-open"); }
async function doFund() {
  const eth = parseFloat($("#fundAmount").value);
  if (!(eth > 0)) return toast("Enter a positive amount", "err");
  if (eth > state.config.fundMaxEth) return toast(`Max ${state.config.fundMaxEth} ETH per fund`, "err");
  $("#fundConfirm").disabled = true;
  try {
    await api("/api/fund", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ network: state.network, eth }),
    });
    toast(`Funded ${eth} ${tokenSym()}`, "ok");
    closeFund();
    await refreshStatus();
  } catch (e) { toast(`Fund: ${e.message}`, "err"); }
  finally { $("#fundConfirm").disabled = false; }
}

// ── sync from Irys ──────────────────────────────────────────────────────────
async function syncRemote() {
  toast("Querying the Irys index…");
  try {
    const owner = state.status?.address;
    const { nodes } = await api(`/api/assets/remote?network=${state.network}${owner ? `&owner=${owner}` : ""}`);
    toast(`Irys index: ${nodes.length} on-chain record${nodes.length === 1 ? "" : "s"} for App-Name=iIrys Frame`, "ok");
  } catch (e) { toast(`Sync: ${e.message}`, "err"); }
}

// ── wiring ───────────────────────────────────────────────────────────────--
function wire() {
  $$("#netToggle .net-toggle__btn").forEach((b) => b.onclick = () => setNetwork(b.dataset.net));

  const dz = $("#dropzone"), fi = $("#fileInput");
  fi.onchange = () => { addFiles(fi.files); fi.value = ""; };
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-over"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  $("#sealBtn").onclick = sealAll;
  $("#addAttr").onclick = () => addAttrRow();
  $("#metaBtn").onclick = uploadMeta;

  $("#fundBtn").onclick = openFund;
  $("#fundConfirm").onclick = doFund;
  $$("#fundModal [data-close]").forEach((el) => el.onclick = closeFund);

  $("#syncBtn").onclick = syncRemote;
  $("#drawerScrim").onclick = closeDrawer;
  $("#search").oninput = (e) => { state.filter.text = e.target.value; renderVault(); };

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); closeFund(); } });
}

boot();
