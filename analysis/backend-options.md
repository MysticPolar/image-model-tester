# Backend options: Vercel, Google Drive, hybrid, or keep Sites + R2

*Analysis date: 2026-11-01. Analysis only: no code, config, or deployment changes.*

**Method.** I read the current backend and bridge code (files listed in §1). I checked platform limits against official docs on 2026-11-01 (sources in §8). I also sent two keyless probes to the Ark endpoint: a CORS preflight and an unauthenticated POST that returned 401. No paid generation calls were made.

---

## TL;DR

- **Recommended: hybrid.** Store data in Google Drive and run generation through a thin Cloudflare Worker you own (option D2 below). It gives you what you're after, data in your own Drive and no ChatGPT popup bridge, without putting Ark keys in the browser. The Worker can reuse the AES-GCM and Seedream code in `lib/volcengine.ts` almost as-is.
- **Drive alone (no proxy) is not recommended as the default.** Ark's preflight currently accepts any origin, but this is undocumented. The 401 error response has no `Access-Control-Allow-Origin` header, so a browser couldn't even read the error. More importantly, the key would then live in browser storage on `mysticpolar.github.io`, an origin shared by **every** GitHub Pages repo under your account. Volcengine's docs say never to expose API keys. Short-lived Ark keys (`GetApiKey`) can only be minted with AK/SK signing, so you would need a backend anyway.
- **Vercel is the weakest fit.** Its 4.5 MB function body limit conflicts with the 32 MB generation request and the 50 MB workspace PUT. Fixing that means re-architecting both paths around direct Blob uploads and URL-based Ark inputs. Hobby is also non-commercial only.
- **The real cost of Drive is the data model, not the API.** Drive v3 documents no compare-and-swap (`If-Match`) on file writes. The single `workspace.json` with revision tokens has to become immutable, content-addressed images plus per-run files plus append-only per-device edit logs. That redesign also removes today's 50 MB cap and stops re-uploading every image on every save.
- **Cheaper alternative if "see my data in Drive" is the only goal:** keep Sites + R2 and add a one-way "Export to Drive" button (`drive.file`, client-side). It's about a day of work and has none of the sync risk.

---

## 1. What the backend does today (from the code)

| Concern | Implementation | Where |
| --- | --- | --- |
| **Identity** | OpenAI Sites injects `oai-authenticated-user-{id,email,full-name}` headers at its dispatch boundary. `getChatGPTUser()` trusts them, and nothing outside Sites can. Writes also require `Origin` to equal the backend origin. | `app/chatgpt-auth.ts`, every `app/api/*/route.ts` |
| **Ark key custody** | One key per user × slot (`pro`, `flash`). AES-GCM with a 32-byte `TESTER_KEY_ENCRYPTION_V1` secret, random 12-byte IV, AAD = `userId:slot`. Stored in R2 at `credentials/<user>/volcengine-<slot>.json`; only the last four characters go back to the browser. Saving a key makes no Ark call. | `lib/volcengine.ts` (`seal`, `unseal`, `saveProviderKey`, `providerStatus`, `getProviderKey`), `app/api/provider/route.ts` |
| **Generation proxy** | `POST /api/generate`: auth, origin check, ≤32 MB body, `n === 1`, ≤10 refs, each a PNG/JPEG/WebP data URL under 10 MB, prompt ≤12,000 chars. Builds the Ark payload (`size: 800x1424`, `response_format: b64_json`, `output_format: png`, `watermark: true`), calls `ark.cn-beijing.volces.com/api/v3/images/generations` with a 270 s timeout, maps 401/403/429 to readable errors, and returns one data URL plus settings. | `app/api/generate/route.ts`, `lib/volcengine.ts` |
| **Workspace sync** | One R2 object `workspaces/<user>.json` holds **everything**: refs, models, prompt, and every run, with every reference and output image inlined as a base64 data URL. Each run `structuredClone`s its refs, so images are duplicated per run. PUT uses R2 `onlyIf: {etagMatches: revision}` (or `etagDoesNotMatch: '*'` for the first write) and returns 409 on a mismatch. It also preserves each run's original `testerAccount`. 50 MB cap. | `app/api/workspace/route.ts` |
| **Client sync loop** | IndexedDB local cache. Each edit triggers a debounced (800 ms) PUT of the **entire** snapshot. Idle devices poll GET every 20 s. A 409 sets `conflict` and shows "Reload from cloud". | `public/app.js` (`save`, `flushCloud`, `loadCloud`, `setInterval(…,20000)`) |
| **Archive** | After each successful PUT, `archiveRecords` writes images once to `test-records/<user>/assets/<path>`, and writes the CSV, `prompt.txt`, and `record.json` under `revisions/v2/<etag>/`. Archive failure is reported separately (`recordsSaved: false`). | `lib/records.ts`, `public/records-core.js` (`recordFiles`, `recordsCSV`) |
| **Records download** | `GET /api/records[?file=]` serves the CSV or an archived file for the latest workspace etag, regenerating lazily. Not in the Pages bridge allowlist; from Pages, the CSV is built client-side from `GET /api/workspace`. | `app/api/records/route.ts`, `public/bridge-policy.js` |
| **GitHub Pages bridge** | `docs/` is a static copy. `pages-bootstrap.js` patches `window.fetch` and forwards `/api/*` calls by `postMessage` to a popup on the Sites origin (`pages-bridge.html`). The popup checks the exact opener, origin, a random channel, and the route allowlist (`workspace` GET/PUT, `provider` GET/PUT, `generate` POST). The popup must stay open. | `public/pages-bootstrap.js`, `public/pages-bridge.js`, `public/bridge-policy.js`, `scripts/build-pages.mjs` |

**What the backend actually has to do.** Strip it down and only three jobs need a server:

1. Prove who the user is.
2. Hold the Ark keys and call Ark.
3. Give durable cross-device storage with a write-conflict check.

The CSV and archive layout are derived data. `records-core.js` already produces them in the browser for exports.

---

## 2. Option A: keep Sites + R2 (baseline)

- **Works today.** It has strong conflict safety (true CAS via R2 `etagMatches`) and server-side key encryption. R2's free tier is 10 GB-month with free egress, and R2 conditional puts are documented [CF-R2a][CF-R2b].
- **Pain points.**
  - Identity is tied to ChatGPT sign-in.
  - The github.io UI depends on a popup that must stay open.
  - Each save re-uploads the whole workspace, images included, and the workspace is capped at 50 MB, which a few dozen runs with 10 MB references will hit.
  - Data is only visible through the app.
  - The platform is a hosted product you don't control. `hosting.json` pins a project ID.
- **Fixes possible without moving:**
  - Split images out of the workspace JSON into content-addressed R2 objects, which removes the 50 MB cap.
  - Add an "Export to Drive" button.

## 3. Option B: Vercel (Functions + Blob)

| Constraint | Vercel fact | Effect on this app |
| --- | --- | --- |
| Function body size | **4.5 MB** max request *and* response body, otherwise 413 `FUNCTION_PAYLOAD_TOO_LARGE`. Streaming is not documented as an exemption. [V-lim] | `/api/generate` takes up to 32 MB, and the base64 PNG response is roughly 1.5–4 MB, so it's close. `/api/workspace` PUT is up to 50 MB. **Both current contracts break.** |
| Duration | Hobby: 300 s default and max. Pro: 300 s default, 800 s max, 1,800 s in beta. Fluid compute is on by default. [V-dur] Rewrites to external origins are capped at 120 s. [V-limits] | 270 s Ark timeout fits on Hobby with about 30 s to spare, but only inside a function, not a rewrite. |
| Workaround for size | Blob *client uploads* go browser → Blob directly with a server-minted token, up to 5 TB. [V-blob-cu][V-blob-price] Ark accepts image **URLs** as input and can return `response_format: url` (valid 24 h). [ARK-img] | Upload refs to Blob, pass signed URLs to Ark, and have Ark return a URL. The function then copies the output to Blob. That's 3–4 more moving parts, plus private-blob signed URLs that Ark must be able to fetch from Beijing. |
| Storage / CAS | Blob `put()` supports `ifMatch` (ETag) and fails with `BlobPreconditionFailedError`. Private stores exist; overwrites can take up to 60 s to propagate unless read with `useCache: false`. [V-blob-sdk][V-blob-priv] | CAS on a small manifest is possible, which is good. KV is not a first-party product any more: Redis-style stores come from the Marketplace (Upstash). [V-storage] |
| Auth | Deployment Protection protects deployments, not app users. [V-dp] | You'd need to add Auth.js or Clerk with Google, plus session handling. |
| Free tier | Hobby: 1 M invocations, 4 active CPU-hrs (I/O wait not billed), 100 GB transfer. Blob: 1 GB storage, 10 k simple and 2 k advanced ops per month; on overage, access is blocked for 30 days. [V-hobby][V-blob-price] | 1 GB of Blob fills after roughly 30–100 runs with large references. |
| Licensing | **Hobby is restricted to non-commercial personal use.** [V-fair] | If this tester supports paid or company work, budget for Pro at $20/month per member. |

**Verdict:** feasible, but it's the most rework. Both main routes have to be rebuilt around Blob indirection, auth is DIY, and the free storage is tiny. Vercel has no advantage over Cloudflare for this workload.

## 4. Option C: Google Drive only (static GitHub Pages, no backend)

### 4.1 Architecture

- The github.io page loads Google Identity Services (GIS) using the **token model**: `initTokenClient` → `requestAccessToken()`, with an authorized JavaScript origin of `https://mysticpolar.github.io`.
- It calls Drive REST v3 directly with `Authorization: Bearer <access token>`.
- No server holds tokens. Google says the token model needs no per-user refresh tokens on a backend. [G-token]

**Scopes.**

- `drive.file`: access only to files the app created or the user opened or shared via the Picker.
- Optionally `drive.appdata`: a hidden per-app folder the user can't see or share.
- Both are **non-sensitive**. [G-scopes-drive]

Proposed layout in the user's Drive. All files are plain binaries rather than Google Docs, so `md5Checksum` and `headRevisionId` stay populated [G-files].

```
Image Model Tester/                       (root folder, found via appProperties {imt:'root'})
  assets/<sha256>.<png|jpg|webp>          immutable, content-addressed (refs + outputs, deduped)
  runs/<runId>.json                       run metadata: prompt, model configs, asset hashes, status
  edits/<deviceId>/<ts>-<rand>.json       append-only edits (review, path label, 开源/闭源, tester)
  settings/<deviceId>.json                per-device draft: prompt, selected models, mode
  exports/test-records.csv                regenerated by the client (records-core.js recordsCSV)
appDataFolder/ (hidden)                   optional: device registry, change-poll token
```

### 4.2 Cross-PC sync

- On a new PC: sign in with the same Google account → `files.list` with `q = appProperties has {key='imt' and value='root'}` → list `runs/` and `edits/` → lazily fetch `assets/` with `alt=media` and cache them in IndexedDB.
- To pick up changes, poll `changes.list` from a stored `startPageToken`. Watch notifications carry no details, so polling is needed anyway. [G-changes] One `changes.list` costs 100 quota units; polling every 20 s uses 300 units/min against a 325,000/min per-user budget. [G-limits]
- ⚠ **Unverified (needs a spike):** whether a second device, with the same Google account and OAuth client, sees the folder created on the first. The docs' `isAppAuthorized` field means "created or opened by the requesting app", which implies yes, but no page states the cross-device case explicitly. [G-files]

### 4.3 Conflict handling without CAS

Drive v3 documents **no** `If-Match`/ETag precondition on `files.update`. The files resource has no `etag` field. What it does have is `version` ("monotonically increasing"), `headRevisionId`, `md5Checksum` and `modifiedTime`. [G-files][G-perf]

Read-check-write therefore always leaves a race window. The substitute is to **design out shared mutable files**:

| Data | Writer | Conflict behavior |
| --- | --- | --- |
| Image bytes | Any device, content-addressed | None. The same bytes give the same name, and a duplicate create is detected by a `files.list` on the hash and skipped. |
| `runs/<id>.json` | Only the device that started the run (single writer). Status moves queued → running → done or error. | None between devices. |
| Human review, path label, 开源/闭源, tester name | Any device, as **new files** under its own `edits/<deviceId>/` | Merge rule: last-writer-wins **per field**, ordered by (`ts`, `deviceId`). Two simultaneous edits to the *same* field of the *same* record keep both entries in the log, and the UI can flag them ("edited on 2 PCs"). Nothing is silently lost, which is stronger than today's whole-workspace 409. |
| Draft prompt and selection | Per device | None. Each PC keeps its own draft, which is also more natural. |
| `exports/test-records.csv` | Regenerated from merged state | Derived, so it's safe to overwrite; worst case is a briefly stale export. |

- **Compaction.** Folding old `edits/` into a snapshot is the only multi-writer step. Make it rare and idempotent: write `snapshot-<ts>.json` and delete only the edits it covers.
- **Path-label uniqueness.** `ensureRecordPaths` is a global invariant. The merge must run it after applying edits, and a collision should be resolved deterministically (lowest `ts` wins, the other is bumped).
- **Simpler alternative.** Keep a single `workspace.json`, read `version` before writing, and re-read after. That *detects* most races but doesn't *prevent* them. It also keeps re-uploading every image (up to 50 MB) per save, which is a poor fit for Drive's per-request costs. Not recommended.

### 4.4 Large images, quotas, storage

- **Uploads.** Simple and multipart uploads are for files of 5 MB or less; resumable uploads are for anything larger. A resumable session is valid for one week. Max file size is 5 TB. Drive has **no batch endpoint for media**, so every image is its own request. [G-upload][G-perf]
- **Downloads.** `files.get?alt=media` with the bearer token, read into a Blob and shown via `URL.createObjectURL`. Images are fetched lazily and cached in IndexedDB.
- **API quota** (new quotas for Cloud projects created on or after 2026-05-01). 1,000,000 units/min per project and 325,000 per user per project. Read costs 5 units, list 100, edit/create 50, download 200. Over quota returns 403 or 429, and Google asks for exponential backoff. [G-limits] A worst-case run of 10 refs, 2 outputs, a run JSON and an edit is about 14 creates, or 700 units. That's ample.
- **Storage.** 15 GB free, shared with Gmail and Photos; over quota, uploads fail. Files in a shared folder count against the **owner's** quota only. [G-storage] Content addressing dedupes references reused across runs, which today are copied into every run. At about 34 MB worst case per run (10 × 3 MB refs + 2 × 2 MB outputs) that's roughly 400 runs before dedupe, and far more in practice.
- **Google Sheet instead of CSV.** You can upload the CSV with `mimeType: application/vnd.google-apps.spreadsheet` using only `drive.file` (Drive converts it), which avoids the separate Sheets scope. Treat the Sheet as a read-only export, because the next upload overwrites anything typed into it. Thumbnails via `IMAGE()` need public URLs, so they won't work for private files. Sheets API limits are 60 reads and 60 writes per minute per user, and spreadsheets are capped at 20 M cells. [G-sheets][G-drive-files] **Recommendation: keep the CSV** and optionally convert to a Sheet on export.

### 4.5 OAuth consent and verification

- `drive.file` and `drive.appdata` are **non-sensitive**, so verification is optional. Without brand verification, consent shows your domain instead of the app name and logo. [G-verif][G-brand]
- Publish the consent screen as **"In production"** (External). With non-sensitive scopes there's no 100-user cap and no unverified-app "danger" screen. [G-prod]
- **Don't stay in "Testing".** Testing is capped at 100 test users for the life of the project, and test-user authorizations **expire after 7 days**. [G-audience] (Google's pages are inconsistent about which warning Testing shows. Either way, Production is the right status.)
- **Token UX.** Token-model access tokens are short-lived (`expires_in`, typically 3,600 s). Google says to get a new one by calling `requestAccessToken()` from a user gesture, and only the popup UX is supported. [G-token] Expect an occasional "Reconnect Google" click. Renew before a long generation batch so the saves at the end don't fail.
- Avoid the full `drive` scope. It's **restricted** and requires a security assessment if data passes through servers. [G-scopes-drive]

### 4.6 Sharing with other testers

- Share the root folder from the Drive UI. Storage stays on your quota. [G-storage]
- Under `drive.file`, a collaborator's copy of the app can only touch items **they** opened via the Google Picker. [G-scopes-drive][G-picker]
- ⚠ **Unverified:** whether picking a *folder* grants the app access to its existing *children*. If it doesn't, collaborators would have to pick files individually, or you'd need the restricted `drive` scope.
- `appDataFolder` **cannot be shared** at all. [G-appdata]
- **For multi-tester sharing, Drive is weaker than a server store.** Plan a spike before committing to it.

### 4.7 Where do the Ark keys live? (the deciding issue)

**Can the browser call Ark directly?**

- Volcengine's docs say nothing about CORS. [ARK-auth]
- Keyless probe on 2026-11-01, preflight: `OPTIONS` from `Origin: https://mysticpolar.github.io` returned 200 with `access-control-allow-origin` reflecting **any** origin (also tested with `https://example.org`), `allow-headers: authorization,content-type` and `allow-credentials: true`.
- Keyless probe, actual request: an unauthenticated `POST` returned **401 with no `Access-Control-Allow-Origin`**. A browser would block reading that error body.
- Whether a successful 200 carries the header couldn't be tested without a paid call.
- Conclusion: it **might** work, it's undocumented, and it could change.

**Even if it works, where would the key sit?**

- In IndexedDB, localStorage or memory on `https://mysticpolar.github.io`. That origin is shared by **all** your project Pages sites (`/image-model-tester/`, `/any-other-repo/`), so any script on any of them, plus any extension or XSS, can read it.
- Storing it in Drive `appDataFolder` doesn't help: the page still has to decrypt it in the browser to send the `Authorization` header.
- Volcengine explicitly says never to expose API keys, warning that someone else could spend your quota. [ARK-key][ARK-manage]

**Mitigations available on the Ark side:**

- Keys can be scoped to specific model IDs ("自定义" permissions). IP allowlists exist but are impractical for home or office browsers. [ARK-manage]
- Temporary keys (`GetApiKey`, up to 30 days) exist, but the call must be **signed with an AK/SK**, so a backend has to mint them. [ARK-tmp]

**Verdict:** Drive-only is acceptable only as an **opt-in "bring your own key, kept in memory for this tab"** mode, with a model-scoped key, for a single trusted user. It should not be the default.

## 5. Option D: hybrid (Drive for data + thin proxy for keys and generation)

| Proxy | Fit |
| --- | --- |
| **D1: keep the existing Sites backend only for `/api/provider` and `/api/generate`** | Zero backend code, but it keeps the ChatGPT popup bridge **and** adds Google sign-in: two identities and two popups. Fine as a stepping stone, poor as an end state. |
| **D2: a new standalone Cloudflare Worker (your own account), authenticated with Google** ✅ | See below. |
| **D3: a Vercel function as the proxy** | Same 4.5 MB body limit as option B. Only works if refs go by URL (§3). ✗ |

**D2 design.**

- **Body size and duration.** Workers accept request bodies up to 100 MB (based on the zone plan; Free included). HTTP-triggered Workers have **no wall-clock limit** while the client stays connected, and waiting on `fetch()` doesn't count as CPU time. Cloudflare sets no response size limit. [CF-lim]
- **CPU limit: watch this.** Free gets **10 ms CPU per request**; Paid ($5/month) gets 30 s by default, up to 5 min. [CF-lim][CF-price] `JSON.parse` plus a regex check over a 32 MB body will exceed 10 ms. Either:
  - **Stream the body through unparsed.** The browser builds the Ark payload (move `seedreamPayload` client-side). The Worker checks only small headers (slot, length) and adds `Authorization`.
  - Or pay $5/month and keep server-side validation.
- **Auth.**
  - The browser sends a Google **ID token** from Sign In With Google, or the access token.
  - The Worker verifies the JWT signature against Google's JWKS, checks `aud` equals your client ID, `iss` and expiry. For an access token it would call `tokeninfo` and check `aud`/`azp` instead.
  - It keeps an allowlist of Google `sub` or email values in an env var.
  - CORS allows only `https://mysticpolar.github.io`.
- **Stateless key custody.**
  - `POST /keys {slot, apiKey}`: the Worker encrypts with its secret using the same `seal()` code, with AAD = `googleSub:slot`, and returns ciphertext only.
  - The browser stores that ciphertext in Drive `appDataFolder`. It's useless without the Worker secret and bound to that Google account.
  - `POST /generate` carries `{slot, ciphertext}` in headers plus the payload. The Worker unseals the key and forwards to Ark.
  - No KV, D1 or R2 needed. The Worker holds no user data at all.
- **Defense in depth.** Create each Ark key with "自定义" permissions limited to its model ID, so Ark itself enforces the Pro→Pro and Flash→Flash binding even though the Worker no longer parses the body. [ARK-manage]
- **Cost.** Free tier: 100,000 requests/day [CF-lim], plenty. Or $5/month for headroom and server-side validation.

## 6. Comparison

| | **A. Sites + R2 (today)** | **B. Vercel + Blob** | **C. Drive only** | **D2. Drive + CF Worker** ✅ |
| --- | --- | --- | --- | --- |
| **API key security** | ✅ Server-side AES-GCM, account-bound | ✅ Server-side (needs a reimplementation) | ❌ Key in browser on a shared github.io origin; against Volcengine guidance | ✅ Server secret; ciphertext in your Drive bound to Google `sub`; model-scoped keys |
| **Identity** | ChatGPT account (Sites-only headers) | DIY (Auth.js or Clerk) | Google | Google (ID-token verification in the Worker) |
| **Cross-device sync** | ✅ Poll every 20 s; whole workspace re-sent | ✅ If rebuilt on Blob | ✅ Drive `changes.list`; ⚠ second-device visibility under `drive.file` needs a spike | Same as C |
| **Conflict safety** | ✅ True CAS (R2 `etagMatches`), whole-workspace 409 | ✅ Blob `ifMatch` on a manifest | ⚠ No CAS; safe only with the append-only, single-writer layout (§4.3) | Same as C |
| **Storage limits** | 50 MB per workspace (app limit); R2 10 GB free | 1 GB free Blob, 4.5 MB body limit | 15 GB per Google account (shared with Gmail and Photos), 5 TB per file | Same as C; the Worker stores nothing |
| **Generation path** | ✅ 32 MB, 270 s | ❌ 4.5 MB body; needs a URL-based redesign | ⚠ Undocumented CORS; error bodies unreadable | ✅ 100 MB body, no wall-clock limit; stream or pay $5 for CPU |
| **Sharing with testers** | Per-account only (each ChatGPT user has their own workspace) | DIY | ⚠ Folder sharing plus Picker; folder-children access unverified | Same as C |
| **Data visible to you** | Only through the app | Only through the app | ✅ Plain files in your Drive | ✅ |
| **Cost** | Included with Sites | Free (non-commercial) or $20 per seat per month | Free (Drive quota) | Free, or $5/month Workers Paid |
| **Setup effort** | None | High: Vercel project, Blob store, auth provider | Medium: Google Cloud project, consent screen, OAuth client | Medium+: C plus a Cloudflare account, Worker, two secrets |
| **Migration effort from current code** | None | **High**: rewrite all four routes plus the client upload path | **High**: new storage layer and data model in `app.js`; drop the bridge | **High (storage) + low (proxy)**: C's storage work plus about 150 lines of Worker mostly lifted from `lib/volcengine.ts` |
| **Ops dependency** | OpenAI Sites (hosted product) | Vercel | Google | Google + Cloudflare (both stable, self-owned) |

## 7. Recommendation

**Go with D2: Google Drive for data, plus a small self-owned Cloudflare Worker for key custody and Seedream calls.** Phase it, and run a spike first.

**Why:**

1. **It meets your goal.** Data lives as ordinary files in your Drive. You can browse, back up and share them, and they survive the app.
2. **It's the only Drive option that keeps keys server-side.** Drive-only can't do that safely, because Ark has no browser-safe credential and short-lived keys need AK/SK on a server.
3. **It removes the ChatGPT dependency and the always-open popup.** Google sign-in becomes the only identity.
4. **It runs on the same runtime as today.** The current backend already runs on Cloudflare Workers, so `seal`, `unseal`, `seedreamPayload` and `generateSeedream` move over almost verbatim, and the Worker's limits (100 MB body, no wall-clock limit) fit the existing 32 MB / 270 s contract.
5. **The required data redesign is an upgrade in its own right.** Content-addressed images and per-run files remove the 50 MB cap, stop re-uploading every image on each save, and dedupe references.

**When to choose something else:**

- If only "files in my Drive" matters, and multi-device editing on the Sites version works fine, choose **A + Export to Drive**. It's far less work and risk.
- If several testers must edit the *same* records at the same time, a server store with real CAS is easier than Drive's append-only merge. **Put R2 behind the same Google-authenticated Worker** (Worker + R2 + Google auth) and add Drive export.

### Main risks

1. **`drive.file` visibility.**
   - (a) A second PC seeing the app-created folder is likely but not stated in the docs.
   - (b) A collaborator gaining access to a shared folder's *children* by picking the folder is unverified.
   - If (b) fails, sharing needs per-file picking or the restricted `drive` scope, which means a security assessment.
   - **Spike this first.**
2. **Merge logic correctness.** LWW-per-field over append-only edits plus the `ensureRecordPaths` uniqueness invariant is new code and needs tests. Getting it wrong means silent review loss, which is exactly what the current 409 prevents.
3. **Token expiry mid-run.** GIS access tokens are short-lived and renew only from a user gesture. A generation that finishes after expiry can't save until the user clicks Reconnect. Keep outputs in IndexedDB first, as today, and flush once a token is available.
4. **Worker CPU on the Free plan.** Parsing a 32 MB body exceeds 10 ms CPU. Stream the body through or pay $5/month.
5. **15 GB Google quota** is shared with Gmail and Photos. Show usage (`about.get` `storageQuota`) in the UI.
6. **Key re-entry.** R2 ciphertexts can't be decrypted outside Sites, and the Sites secret must not be exported. Each user re-enters their Pro and Flash keys once. That's also a good moment to issue model-scoped keys.
7. **Consent screen status.** Publish to Production. Leaving it in Testing gives 7-day authorization expiry.
8. **Shared `mysticpolar.github.io` origin.** Even without keys, the Google access token lives in that origin's memory while the page is open. Keep the token in memory only, never in localStorage.

## 8. Rough migration outline

**Phase 0: spike (~1 day), no production changes.**

- Create a throwaway Google Cloud project with a `drive.file` OAuth client for `https://mysticpolar.github.io`.
- From PC 1, create a folder and file. From PC 2, list them.
- Share the folder with a second Google account and pick it in the Picker, then check whether its children are accessible.
- Decide go or no-go on Drive-for-sharing.

**Phase 1: Worker proxy.** New files `proxy/src/index.ts` and `proxy/wrangler.toml`.

- Routes: `POST /keys`, `POST /generate`, `OPTIONS`.
- Google ID-token verification against JWKS, with `aud`, `iss` and `exp` checks.
- `sub` allowlist.
- CORS locked to the Pages origin.
- Reuse `seal`/`unseal` with AAD changed to `googleSub:slot`, plus `generateSeedream`, by extracting them from `lib/volcengine.ts` into a shared module.
- Secrets: `TESTER_KEY_ENCRYPTION_V2` (new; never reuse the Sites secret) and `GOOGLE_CLIENT_ID`.
- Tests: adapt `tests/volcengine.test.cjs`.

**Phase 2: Drive storage layer.**

- New `public/google-auth.js`: GIS token client, ID token, reconnect UX.
- New `public/drive-store.js`: root folder bootstrap via `appProperties`, content-addressed asset upload (multipart up to 5 MB, resumable above), run and edit writes, `changes.list` polling, merge (LWW per field plus `ensureRecordPaths`), backoff on 403/429, and an IndexedDB asset cache.
- New tests `tests/drive-store.test.cjs` with a fake Drive, mirroring how `tests/workspace.test.cjs` uses a fake bucket: merge order, duplicate edits, path collisions, offline queue.

**Phase 3: app integration.**

- `public/app.js`:
  - Replace `fetch('/api/workspace')` in `flushCloud`, `loadCloud` and the 20 s poll, and the 409 / "Reload from cloud" handling, with `drive-store` calls.
  - Point Seedream `execute()` at the Worker URL with a bearer ID token instead of `credentials:'same-origin'` to `/api/generate`.
  - Change the provider dialog's `refreshProvider` and save path to Worker `/keys`, with ciphertext stored in `appDataFolder`.
  - Read the "download saved records" path from Drive.
- `public/records-core.js`: mostly unchanged (`recordsCSV`, `recordFiles` are reused). Possibly add a hash-based asset path helper.
- `public/workbench.html` and `docs/index.html` (via `scripts/build-pages.mjs`):
  - Replace "Connect cloud" with "Connect Google".
  - Update the provider dialog copy ("encrypted on the server").
  - Update the sync status labels.
- `scripts/build-pages.mjs`: stop copying `bridge-policy.js` and `pages-bootstrap.js`. Inject or configure the Google client ID and Worker URL as public constants (neither is a secret).
- Delete `public/pages-bootstrap.js`, `public/pages-bridge.js`, `public/pages-bridge.html` and `public/bridge-policy.js`, and remove the bridge tests in `tests/pages.test.cjs`.
- Run `pnpm build:pages` to regenerate `docs/`.

**Phase 4: data migration (client-side, one-time).**

- While still connected to Sites, read `GET /api/workspace`. It returns the full workspace with inlined data URLs, and the bridge already allows it.
- Hash and upload every unique image, then write `runs/*.json` and fold existing human reviews into an initial `edits/<migration>/` file.
- Verify that record and file counts match the CSV from `recordsCSV`.
- Keep the R2 data untouched as a backup.

**Phase 5: retire.**

- After the cut-over has been verified on both PCs, stop using:
  - `app/api/workspace/route.ts`
  - `app/api/records/route.ts`
  - `app/api/provider/route.ts`
  - `app/api/generate/route.ts`
  - `lib/records.ts`
  - `app/chatgpt-auth.ts`
  - `worker/index.ts`
  - `.openai/hosting.json`
  - the Next/vinext scaffolding
- Update `README.md` (hosting, data, key sections).
- Decide separately whether to delete the Sites project. Keep it read-only until backups are confirmed.

---

## Sources

All checked 2026-11-01 unless noted.

**Vercel**
- [V-lim] Functions limitations (4.5 MB body, Fluid default, memory): https://vercel.com/docs/functions/limitations
- [V-dur] Function duration: https://vercel.com/docs/functions/configuring-functions/duration
- [V-limits] Platform limits (120 s proxied-request timeout, Blob rate limits): https://vercel.com/docs/limits
- [V-hobby] Hobby plan included usage: https://vercel.com/docs/plans/hobby
- [V-fair] Fair use (Hobby non-commercial): https://vercel.com/docs/limits/fair-use-guidelines
- [V-blob-cu] Blob client uploads: https://vercel.com/docs/vercel-blob/client-upload
- [V-blob-sdk] Blob SDK (`allowOverwrite`, `ifMatch`): https://vercel.com/docs/vercel-blob/using-blob-sdk and https://vercel.com/docs/vercel-blob
- [V-blob-priv] Private Blob storage (consistent reads, download charges): https://vercel.com/docs/vercel-blob/private-storage
- [V-blob-price] Blob usage and pricing (5 TB max file, Hobby 1 GB): https://vercel.com/docs/vercel-blob/usage-and-pricing
- [V-storage] Storage overview (Marketplace Redis): https://vercel.com/docs/storage
- [V-dp] Deployment protection pricing: https://vercel.com/docs/deployment-protection/usage-and-pricing

**Google**
- [G-upload] Drive uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- [G-files] Files resource (`version`, `headRevisionId`, `md5Checksum`, `isAppAuthorized`): https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- [G-perf] Drive performance (no media batching, partial responses): https://developers.google.com/workspace/drive/api/guides/performance
- [G-changes] Changes API: https://developers.google.com/workspace/drive/api/guides/manage-changes
- [G-limits] Drive quotas (page updated 2026-10-30): https://developers.google.com/workspace/drive/api/guides/limits
- [G-scopes-drive] Drive scope sensitivity: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- [G-appdata] App data folder: https://developers.google.com/workspace/drive/api/guides/appdata
- [G-picker] Picker overview: https://developers.google.com/workspace/drive/picker/guides/overview
- [G-token] GIS token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- [G-prod] Production readiness overview: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- [G-audience] Audience / publishing status (100 test users, 7-day expiry): https://support.google.com/cloud/answer/15549945
- [G-verif] When verification is needed: https://support.google.com/cloud/answer/13463073
- [G-brand] Branding: https://support.google.com/cloud/answer/15549049
- [G-sheets] Sheets API limits: https://developers.google.com/workspace/sheets/api/limits
- [G-drive-files] Drive file-type limits (20 M cells): https://support.google.com/drive/answer/37603
- [G-storage] Google storage (15 GB, shared-folder quota): https://support.google.com/googleone/answer/9312312

**Volcengine Ark**
- [ARK-img] Image generation API (refs, `response_format`, 24 h URL validity): https://docs.volcengine.com/docs/82379/1541523?lang=zh
- [ARK-auth] Base URL and auth (no CORS statement): https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh
- [ARK-key] API key guidance: https://docs.volcengine.com/docs/ark/api-key?lang=zh
- [ARK-manage] Key management (per-model permissions, IP allowlist): https://docs.volcengine.com/docs/ark/manage-api-keys?lang=zh
- [ARK-tmp] Temporary API key (`GetApiKey`, AK/SK-signed): https://docs.volcengine.com/docs/ark/get-api-key-api?lang=zh
- Live probe, 2026-11-01: `OPTIONS` and keyless `POST` to `https://ark.cn-beijing.volces.com/api/v3/images/generations`. The preflight reflects any origin; the 401 response lacks `Access-Control-Allow-Origin`.

**Cloudflare**
- [CF-lim] Workers limits (100 MB body, no duration limit, 10 ms Free CPU): https://developers.cloudflare.com/workers/platform/limits/
- [CF-price] Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- [CF-R2a] R2 pricing: https://developers.cloudflare.com/r2/pricing/
- [CF-R2b] R2 Workers API (`onlyIf` conditional put): https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

**Not verified, flagged in the text:**
- Drive cross-device and shared-folder-children visibility under `drive.file`.
- Ark CORS on a successful 2xx response.
- Exact GIS token lifetime (taken from `expires_in` in practice, not stated on the guide page).
- Vercel streaming exemption from the 4.5 MB limit (not stated, so assumed none).
- Several Ark parameter details came from a summarized page section rather than verbatim text.
