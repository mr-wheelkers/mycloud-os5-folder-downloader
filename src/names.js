// File-name sanitising. Mirrors what Firefox's downloads API accepts
// (DownloadPaths.sanitize) plus Windows/macOS/Linux filesystem limits.
// Two modes:
//   normal - minimal changes, keeps Unicode
//   safe   - ASCII-only, short, with a unique suffix; used when a name was rejected

/* exported Names */
const Names = (() => {
  // control chars, C1 controls, chars illegal on Windows, path separators, % (Firefox rewrites it)
  const ILLEGAL = /[\x00-\x1f\x7f-\x9f:*?"<>|\\/%]/g;
  // invisible / bidi / format chars that Firefox strips (spoofing protection)
  const INVISIBLE = /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8]/g;
  const ODD_SPACE = /[\s\u2028\u2029]/g; // tabs, NBSP, ideographic space... -> plain space
  const RESERVED = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)(\..*)?$/i;
  // extensions Firefox refuses to save as-is (it appends ".download")
  const DANGEROUS_EXT = /\.(lnk|local|url|desktop|scf|website|appref-ms|search-ms|settingcontent-ms)$/i;

  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s).length;

  function truncateBytes(s, max) {
    if (bytes(s) <= max) return s;
    let out = "";
    for (const ch of s) { if (bytes(out + ch) > max) break; out += ch; }
    return out;
  }

  // Shorten to max bytes while keeping a sensible extension.
  function fit(s, max, keepExt) {
    if (bytes(s) <= max) return s;
    const m = keepExt && s.match(/(\.[A-Za-z0-9_-]{1,12})$/);
    const ext = m ? m[1] : "";
    return truncateBytes(s.slice(0, s.length - ext.length), max - bytes(ext)).replace(/[\s.]+$/, "") + ext;
  }

  function trimEdges(s) { return s.replace(/^[\s.]+|[\s.]+$/g, ""); }

  function segment(name, { isFile, safe, uniq }) {
    let s = String(name == null ? "" : name).normalize("NFC")
      .replace(INVISIBLE, "")
      .replace(ILLEGAL, "_")
      .replace(ODD_SPACE, " ");
    if (safe) {
      s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")  // e-acute -> e
        .replace(/[^A-Za-z0-9 ._()\[\]{}@#&+,;=!~'-]/g, "_")
        .replace(/_{2,}/g, "_").replace(/ {2,}/g, " ");
    }
    s = trimEdges(s);
    if (!s || /^_*$/.test(s) && safe) s = isFile ? "file" : "folder";
    if (RESERVED.test(s)) s = "_" + s;
    if (isFile && uniq) {                    // "name~abc123.ext"
      const m = s.match(/^(.*?)(\.[A-Za-z0-9_-]{1,12})?$/);
      s = fit(m[1], safe ? 80 : 180, false) + "~" + uniq + (m[2] || "");
    }
    if (isFile && DANGEROUS_EXT.test(s)) s += ".download";
    s = fit(s, safe ? (isFile ? 100 : 50) : 200, isFile);
    s = trimEdges(s);
    return s || (isFile ? "file" : "folder");
  }

  // segs: original names [root, dir, ..., fileName]
  function build(segs, { safe = false, uniq = "" } = {}) {
    const last = segs.length - 1;
    return segs.map((n, i) => segment(n, { isFile: i === last, safe, uniq: i === last ? uniq : "" })).join("/");
  }

  // Firefox's own error messages for names it refuses
  const isNameError = (msg) => /illegal|invalid|filename|path|back-reference|too long/i.test(String(msg || ""));
  // downloads.onChanged interrupt reasons caused by the local file, not the network
  const isFileError = (reason) => /^FILE_/.test(String(reason || ""));

  return { segment, build, isNameError, isFileError, bytes };
})();

if (typeof module !== "undefined") module.exports = Names;
