# Folder Downloader for My Cloud OS 5

A Firefox extension that downloads **whole folders, with their subfolders**, from the My Cloud OS 5 web app ([os5.mycloud.com](https://os5.mycloud.com)). The folder structure is kept.

When you're away from home, the official web app only lets you download individual files ([known gap](https://community.wd.com/t/folder-download-on-os5/273265)). This extension fills that gap.

> **Unofficial.** Not affiliated with or endorsed by Western Digital. "My Cloud" is a trademark of Western Digital. The extension uses an undocumented API, so a WD update can break it.

## Install

- **Firefox Add-ons:** *(link once approved)*
- **From source (temporary):** clone this repo, then in Firefox open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `src/manifest.json`. The add-on is removed when Firefox restarts.

Requires Firefox 140 or later.

## Use

1. Turn off Firefox's per-file prompt: **Settings → General → Downloads → "Always ask you where to save files"** off.
2. Log in at os5.mycloud.com and open the folder you want.
3. Click the toolbar icon → **Download this folder**.

Files land in `Downloads/MyCloud/<folder>/…`. Keep the WD tab open while the download runs.

| Feature | |
|---|---|
| Parallel downloads | 1–8 (default 3); your NAS's upload speed is the real limit |
| Pause / Stop | Stop cancels in-flight files |
| Resume | Finished files are remembered per folder; start again and they're skipped |
| Retries | Each file 3×, then listed as failed; **Retry failed** re-runs them with safe names |
| Invalid names | Names illegal on your OS are fixed automatically (see below) |
| Token refresh | WD tokens last 15 min; the extension reloads the WD tab to get a new one |

## Invalid file names

NAS file names can contain characters that Windows, macOS or Firefox won't accept, such as `: * ? " < > |`, control or invisible characters, `CON`/`NUL`, trailing dots, or names that are too long. The extension handles them in three steps:

1. **Normal clean-up.** Illegal characters become `_`, invisible/bidi characters are removed, reserved names get a `_` prefix, and long names are shortened to 200 bytes with the extension kept.
2. **Safe-name fallback.** If Firefox or the filesystem still rejects a file (for example, a path too long for Windows), it is retried with an ASCII-only, shortened name plus a unique suffix: `résumé:v2.pdf` → `resume_v2~f3k9a1.pdf`.
3. **Collisions.** Two remote names that clean up to the same local name, like `a?.jpg` and `a_.jpg`, never overwrite each other. The second one gets a `~id` suffix.

Every renamed file is listed in `_renamed-files.txt` in the downloaded folder, mapping the original path to the saved path.

## How it works

The extension uses the same relay API the web app uses (`https://prod-*.wdckeystone.com/<deviceId>/sdk/…`):

1. **Auth:** it watches the web app's own requests to `*.wdckeystone.com` and reuses their short-lived Bearer token and device URL. It never sees your password.
2. **List:** `GET /sdk/v2/filesSearch/parents?ids=<folderId>&pageToken=…` is called recursively. Directories have `mimeType: application/x.wd.dir`.
3. **Download:** `GET /sdk/v2/files/<id>/content?download=true&access_token=…` is the same URL as the web app's Download button. Each file goes through `browser.downloads`.

## Privacy

No analytics or telemetry. The only network traffic goes to WD's own servers, and only to download your files. Local storage holds the IDs of completed files and nothing else.

## Permissions

| Permission | Why |
|---|---|
| `webRequest` + `*.wdckeystone.com` | Read the web app's auth token and device URL; call the WD API |
| `os5.mycloud.com` | Read the current folder ID from the tab URL |
| `tabs` | Find and reload the WD tab to refresh an expired token |
| `downloads` | Save files with their folder paths |
| `storage` | Remember finished files, for resuming |

## Development

```sh
npm install
npm run lint     # web-ext lint
npm start        # launch a Firefox with the extension loaded
npm run build    # zip into web-ext-artifacts/
```

### Releasing / AMO submission

1. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Add them as repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
3. Bump `version` in `src/manifest.json`, commit, then `git tag v1.0.1 && git push --tags`.

The **Release** workflow lints, builds, submits the version to addons.mozilla.org (listed, so it goes to Mozilla review) and publishes a GitHub Release with the zip. Listing text lives in `amo-metadata.json`; AMO only applies it on the first submission.

## Contributing

Issues and PRs are welcome. HAR captures help a lot when WD changes the API, but **strip `Authorization` headers and `access_token` parameters first**: they contain live login tokens.

## License

[MIT](LICENSE)
