// WD My Cloud OS5 Folder Downloader — background script
// Captures the web app's Bearer token + device base URL, walks a folder tree
// via /sdk/v2/filesSearch/parents, and hands each file to Firefox's download manager.

const DIR_MIME = "application/x.wd.dir";
const LIST_FIELDS = "id,name,mimeType,size,parentID,trashed";

// ---------- auth capture ----------
let auth = { token: null, exp: 0, base: null }; // base = https://prod-xxx.wdckeystone.com/<deviceId>

function jwtExp(tok) {
  try {
    const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (p.exp || 0) * 1000;
  } catch { return 0; }
}

function captureFromUrl(url, tok) {
  const m = url.match(/^(https:\/\/[^/]+\.wdckeystone\.com\/[0-9a-f-]{36})\/sdk\//i);
  if (!m || !tok) return;
  const exp = jwtExp(tok);
  if (exp >= auth.exp) auth = { token: tok, exp, base: m[1] };
}

browser.webRequest.onSendHeaders.addListener(
  (d) => {
    const h = (d.requestHeaders || []).find((x) => x.name.toLowerCase() === "authorization");
    let tok = h && h.value.startsWith("Bearer ") ? h.value.slice(7) : null;
    if (!tok) { const q = d.url.match(/[?&]access_token=([^&]+)/); if (q) tok = decodeURIComponent(q[1]); }
    captureFromUrl(d.url, tok);
  },
  { urls: ["https://*.wdckeystone.com/*"] },
  ["requestHeaders"]
);

const tokenFresh = (marginMs = 90_000) => auth.token && auth.exp - Date.now() > marginMs;

async function findWdTab() {
  const tabs = await browser.tabs.query({ url: "https://os5.mycloud.com/*" });
  return tabs[0] || null;
}

// The web app refreshes its token on load; reload its tab if ours is about to expire.
async function ensureToken() {
  if (tokenFresh()) return auth.token;
  const tab = await findWdTab();
  if (!tab) throw new Error("Token expired and no os5.mycloud.com tab is open. Open it and log in.");
  setStatus("Refreshing login token…");
  await browser.tabs.reload(tab.id);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (tokenFresh()) return auth.token;
  }
  throw new Error("Could not get a fresh token. Click around in the WD tab (open a folder), then press Resume.");
}

// ---------- API ----------
async function api(path, attempt = 0) {
  const tok = await ensureToken();
  const r = await fetch(auth.base + path, { headers: { Authorization: "Bearer " + tok } });
  if (r.status === 401 && attempt < 2) { auth.exp = 0; return api(path, attempt + 1); }
  if ((r.status >= 500 || r.status === 429) && attempt < 4) { await sleep(2000 * (attempt + 1)); return api(path, attempt + 1); }
  if (!r.ok) throw new Error(`API ${r.status} on ${path.split("?")[0]}`);
  return r.json();
}

async function getFile(id) {
  return api(`/sdk/v2/files/${id}?pretty=false&fields=id,name,mimeType,parentID`);
}

async function listChildren(id) {
  const out = [];
  let pageToken = "";
  do {
    const j = await api(`/sdk/v2/filesSearch/parents?pretty=false&ids=${id}` +
      `&fields=pageToken,${LIST_FIELDS}&limit=500&pageToken=${encodeURIComponent(pageToken)}`);
    out.push(...(j.files || []));
    pageToken = j.pageToken || "";
  } while (pageToken);
  return out;
}

// ---------- job state ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /[<>:"/\\|?*\x00-\x1f]/g;
const clean = (s) => (s || "_").replace(BAD, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 200) || "_";

let job = null;
function newJob(rootId, concurrency) {
  return {
    rootId, concurrency, rootName: "", status: "Starting…", running: true, paused: false,
    scanning: true, foldersScanned: 0, queue: [], total: 0, totalBytes: 0,
    done: 0, doneBytes: 0, skipped: 0, failed: [], active: new Map(), error: null,
  };
}
function setStatus(s) { if (job) job.status = s; }

async function loadDoneSet(rootId) {
  const k = "done_" + rootId;
  const s = await browser.storage.local.get(k);
  return new Set(s[k] || []);
}
let doneSet = new Set(), saveTimer = null;
function markDone(id) {
  doneSet.add(id);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => browser.storage.local.set({ ["done_" + job.rootId]: [...doneSet] }), 2000);
}

async function scan(folderId, relPath) {
  if (!job.running) return;
  const kids = await listChildren(folderId);
  job.foldersScanned++;
  setStatus(`Scanning… ${job.foldersScanned} folders, ${job.total} files`);
  for (const f of kids) {
    if (f.trashed) continue;
    const p = relPath + "/" + clean(f.name);
    if (f.mimeType === DIR_MIME) { await scan(f.id, p); continue; }
    if (doneSet.has(f.id)) { job.skipped++; continue; }
    job.queue.push({ id: f.id, path: p, size: +f.size || 0, tries: 0 });
    job.total++; job.totalBytes += +f.size || 0;
  }
}

async function startDownload(item) {
  const tok = await ensureToken();
  const url = `${auth.base}/sdk/v2/files/${item.id}/content?download=true&access_token=${encodeURIComponent(tok)}`;
  const dlId = await browser.downloads.download({
    url, filename: "MyCloud/" + item.path.replace(/^\//, ""),
    conflictAction: "overwrite", saveAs: false,
  });
  job.active.set(dlId, item);
}

browser.downloads.onChanged.addListener((d) => {
  if (!job || !job.active.has(d.id) || !d.state) return;
  const item = job.active.get(d.id);
  if (d.state.current === "complete") {
    job.active.delete(d.id); job.done++; job.doneBytes += item.size; markDone(item.id);
    browser.downloads.erase({ id: d.id }); // keep the download list tidy
  } else if (d.state.current === "interrupted") {
    job.active.delete(d.id);
    if (++item.tries < 3) job.queue.unshift(item); else job.failed.push(item.path);
  }
});

async function pump() {
  while (job.running) {
    if (job.paused) { await sleep(500); continue; }
    while (!job.paused && job.active.size < job.concurrency && job.queue.length) {
      const item = job.queue.shift();
      try { await startDownload(item); }
      catch (e) { job.failed.push(item.path + " — " + e.message); }
    }
    if (!job.scanning && !job.queue.length && !job.active.size) break;
    if (!job.scanning)
      setStatus(`Downloading… ${job.done}/${job.total}` + (job.failed.length ? `, ${job.failed.length} failed` : ""));
    await sleep(500);
  }
  if (job.running) {
    job.running = false;
    setStatus(`Finished: ${job.done} downloaded, ${job.skipped} already done, ${job.failed.length} failed.`);
  }
}

async function run(rootId, concurrency) {
  job = newJob(rootId, concurrency);
  try {
    if (!auth.base) throw new Error("No WD session seen yet. Open/refresh the os5.mycloud.com tab, open any folder, then retry.");
    doneSet = await loadDoneSet(rootId);
    const root = await getFile(rootId);
    job.rootName = clean(root.name);
    const p = pump();                       // download while still scanning
    await scan(rootId, job.rootName);
    job.scanning = false;
    await p;
  } catch (e) {
    job.error = e.message; job.running = false; job.scanning = false; setStatus("Error: " + e.message);
  }
}

// ---------- popup messaging ----------
browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.cmd) {
    case "state": {
      const tab = await findWdTab();
      return {
        hasAuth: !!auth.base, tokenFresh: tokenFresh(0),
        job: job && {
          ...job, active: job.active.size, queue: job.queue.length,
          activeNames: [...job.active.values()].map((i) => i.path),
        },
        wdTabUrl: tab ? tab.url : null,
      };
    }
    case "start":
      if (job && job.running) return { ok: false, err: "A job is already running." };
      run(msg.folderId, msg.concurrency || 3);
      return { ok: true };
    case "pause": if (job) job.paused = !job.paused; return { ok: true };
    case "stop":
      if (job) {
        job.running = false; job.scanning = false; setStatus("Stopped. Start again to resume (finished files are skipped).");
        for (const id of job.active.keys()) browser.downloads.cancel(id).catch(() => {});
        job.active.clear(); job.queue = [];
      }
      return { ok: true };
    case "reset":
      await browser.storage.local.remove("done_" + msg.folderId); return { ok: true };
  }
});
