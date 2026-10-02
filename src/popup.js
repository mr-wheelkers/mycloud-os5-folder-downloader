const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const fmt = (b) => { const u=["B","KB","MB","GB","TB"]; let i=0; while(b>=1024&&i<4){b/=1024;i++;} return b.toFixed(i?1:0)+" "+u[i]; };
let folderId = null;

async function currentFolder() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const m = tab && tab.url && tab.url.match(/^https:\/\/os5\.mycloud\.com\/.*?folders\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

async function refresh() {
  const s = await send({ cmd: "state" });
  folderId = folderId || await currentFolder();
  $("ctx").textContent = !s.hasAuth
    ? "No WD session detected yet. Open os5.mycloud.com, log in and open a folder."
    : folderId ? `Folder ID: ${folderId}` : "Navigate to the folder you want in the WD tab, then reopen this popup.";
  $("start").disabled = !s.hasAuth || !folderId || (s.job && s.job.running);
  const j = s.job;
  if (!j) return;
  $("status").textContent = (j.paused ? "[Paused] " : "") + j.status;
  $("pause").textContent = j.paused ? "Resume" : "Pause";
  const pct = j.totalBytes ? (100 * j.doneBytes / j.totalBytes) : 0;
  $("bar").style.width = pct.toFixed(1) + "%";
  $("nums").textContent = `${j.rootName || ""}  ·  ${j.done}/${j.total} files  ·  ${fmt(j.doneBytes)} / ${fmt(j.totalBytes)}` +
    (j.scanning ? " (still scanning)" : "") + (j.skipped ? `  ·  ${j.skipped} skipped (done earlier)` : "") +
    (j.renamed ? `  ·  ${j.renamed} renamed (see _renamed-files.txt)` : "");
  $("err").textContent = j.error || "";
  $("activeWrap").hidden = !j.activeNames.length; $("active").textContent = j.activeNames.join("\n");
  $("retry").hidden = !j.failed.length || j.running;
  $("failWrap").hidden = !j.failed.length; $("failed").textContent = j.failed.join("\n");
}

$("start").onclick = async () => {
  const r = await send({ cmd: "start", folderId, concurrency: Math.max(1, Math.min(8, +$("conc").value || 3)) });
  if (!r.ok) $("err").textContent = r.err;
  refresh();
};
$("retry").onclick = async () => {
  const r = await send({ cmd: "retryFailed" });
  if (!r.ok) $("err").textContent = r.err;
  refresh();
};
$("pause").onclick = () => send({ cmd: "pause" }).then(refresh);
$("stop").onclick = () => send({ cmd: "stop" }).then(refresh);
$("reset").onclick = (e) => { e.preventDefault(); if (folderId) send({ cmd: "reset", folderId }).then(() => $("err").textContent = "Progress cleared."); };

refresh(); setInterval(refresh, 1000);
