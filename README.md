# Image Model Tester

A minimal workspace for comparing image-generation models: upload multiple references, enter one shared prompt, select models, generate 1 or 4 images per model, and compare or download the results.

## Use on either PC

Open https://image-model-tester-yuhao.yuhaoguo.chatgpt.site and sign in with the same ChatGPT account. Wait for **Saved to cloud** before switching devices. References, prompts, model configurations, results, and history are saved to an account-scoped R2 object. Conflicting changes from another device are rejected rather than silently overwritten.

GitHub stores the source code; the published site runs the app. Cloning this repository does not download your hosted workspace or credentials. GitHub pushes do not automatically update the hosted site.

## Seedream connection (Volcengine / 火山引擎)

The tester includes Seedream 5.0 Pro (`doubao-seedream-5-0-pro-260628`) and Seedream 5.0 Flash (`doubao-seedream-5-0-flash-260915`). Both are configured for image-to-image generation: **one image per request, 1K / 9:16**, using Volcengine's documented `800x1424` portrait mapping. Your prompt and ordered references are sent unchanged. No automatic batching or prompt rewriting.

1. Open the hosted tester and click **API settings**.
2. Enter two standard Volcengine Ark API keys in the separate **Pro** and **Flash** fields, each with access to its respective model. Get it at https://ark.volcengine.com/region:cn-beijing/apikey . Agent/Coding Plan keys are not supported by this standard Ark connection.
3. Save the keys. Each is encrypted with AES-GCM and bound to both your account and its model. The keys are stored separately from workspace data. Only their last four characters are returned to the browser. Leave a field blank to keep that model's existing key. No keys are included in workspace exports or GitHub. A previously saved shared key is not used as a fallback; enter the respective keys in the new fields.
4. Upload references, enter a prompt, select one or both models, and click Generate. Selecting both models makes one request to each, either together or sequentially.

For Seedream, the four-image control is disabled. Limits: 10 reference images, under 10 MB each, and 32 MB combined JSON request. Model access and balance are checked by Volcengine when you generate; saving a key makes no paid generation call.

The production Site has the `TESTER_KEY_ENCRYPTION_V1` secret configured. Do not rotate this secret without migrating encrypted keys. For local development, set this variable to a randomly generated 32-byte base64 value in ignored `.dev.vars` before starting the server. Never commit that file or use the hosted encryption secret in local development. Local credentials and storage remain separate from production.

Custom models still use the generic gateway contract below; their provider keys belong on the gateway server.

## Run locally

Install Node.js 24 and Git, then:

```sh
git clone https://github.com/MysticPolar/image-model-tester.git
cd image-model-tester
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Open the localhost URL printed by the terminal (normally http://localhost:5173). For local development only, visit `/signin-with-chatgpt?return_to=/` on that origin to establish the starter's local test identity. It is not your real ChatGPT account. Its cookie and R2 emulator data remain in this checkout's ignored `.wrangler/` directory.

Production uses Sites authentication. The local test identity is not included in production builds. Local storage is separate on each PC; use the hosted URL for a shared workspace. Other PCs cannot access your computer's localhost address.

```sh
pnpm test
pnpm build
pnpm start
```

`pnpm start` previews the built worker locally; it does not deploy or simulate sign-in.

## Gateway contract

The browser sends a JSON POST:

```json
{
  "model": "provider-model-id",
  "prompt": "Your unchanged prompt",
  "images": ["data:image/png;base64,..."],
  "n": 1
}
```

Return JSON containing separate PNG, JPEG, or WebP base64 data URLs:

```json
{ "images": ["data:image/png;base64,..."] }
```

Return four elements for `n: 4`. Partial outputs are preserved. Each model request has a five-minute browser timeout. Failures and retries are independent per model. References are never silently dropped.

## Data and export

- Local cache: IndexedDB, scoped to the browser and origin.
- Hosted workspace: per-account R2 object, protected by authenticated API routes.
- Cloud saves: debounced; idle devices check for updates every 20 seconds.
- Conflicts: conditional writes with revision tokens; reload from cloud when prompted.
- Limits: 20 MB per reference file; 50 MB per cloud workspace payload.
- ZIP export: original references, output files, and a manifest with prompts, settings, statuses, and timing.
- Provider keys, encryption secrets, uploaded images, caches, and generated outputs are excluded from source control.

## Code map

| Path | Purpose |
| --- | --- |
| `public/workbench.html` | Layout |
| `public/app.js` | Uploads, model selection, generation, sync, history, exports |
| `public/style.css` | Responsive styling |
| `app/api/workspace/route.ts` | Authenticated storage API with revision checks |
| `app/chatgpt-auth.ts` | Sites authentication helpers |
| `.openai/hosting.json` | Existing Site identity and R2 binding |
| `vite.config.ts`, `worker/` | Worker runtime and local bindings |
| `tests/workspace.test.cjs` | Storage-handler tests with an in-memory bucket |

## Hosting

The production app is deployed through Sites. Preserve the existing Site identity when updating it. GitHub Pages alone cannot run this app's authenticated storage API.

For another host, implement authentication and a compatible R2 binding first. Do not trust visitor-supplied identity headers outside the Sites dispatch boundary.

## Verification

The app has built successfully. Storage tests cover save/read, stale revisions, account isolation, request-origin checks, and anonymous rejection using a fake bucket. Seedream payload, encryption, account binding, safe error handling, and one-request behavior are tested with fixtures. Live generation requires your actual Ark key and model access; syncing across two actual signed-in PCs still requires verification.


## Automatic test records and CSV archive

Open **Test records** in the header (or `workbench.html#records`). Each model attempt has one record, including queued, running, successful, partial, and failed attempts. The tester name defaults to the signed-in display name and can be changed before a run. New records capture the signed-in account separately; historical tester names remain blank if they were not recorded.

The log includes the prompt, ordered reference filenames and paths, output paths, model ID/provider, run settings, status/error, timestamps and duration. **Review** adds model source (开源 / 闭源 / unknown), judge type/name/model, verdict, optional 0–5 score, and notes. These are manual assessments; the app does not call a judge model. Source classification defaults to unknown unless configured or reviewed.

Every successful workspace save also writes a UTF-8 `.csv` archive and named reference/output image files to private account-scoped R2 storage. Metadata is scoped by workspace revision to avoid races. An archive failure is reported separately from a workspace save failure; downloads retry materialization if needed. Existing workspaces are archived on their first save after upgrading.

- **All records CSV** downloads the current local log, including edits awaiting sync.
- **CSV + all images** downloads a ZIP with `test-records.csv`, plus `tests/<timestamp>_<run-id>/prompt.txt`, ordered `references/`, and numbered `models/<index>_<model>/outputs/` folders with per-attempt `record.json`.
- **Download all** on a run uses the same format for that run.
- `GET /api/records` downloads the latest saved cloud CSV; `?file=<relative-path>` retrieves an archived file for the signed-in account.

Paths are portable archive paths, not the original PC's full filesystem paths (browsers do not provide those). Original reference basenames are preserved in CSV. Images remain their original PNG/JPEG/WebP bytes; CSV stores references, not embedded pictures. CSV cells are quoted, include a UTF-8 BOM for Chinese text, and neutralize spreadsheet formulas; `prompt.txt` retains the exact prompt. API keys are excluded.

Existing limits still apply: the active workspace has a 50 MB cloud payload limit, and generation requires keeping the tab open. A closed tab can leave a last-known queued/running status; this version is not a background job service.
