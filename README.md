# Image Model Tester

A minimal workspace for comparing image-generation models: upload multiple references, enter one shared prompt, select models, generate 1 or 4 images per model, and compare or download the results.

## Use on either PC

Open https://image-model-tester-yuhao.yuhaoguo.chatgpt.site and sign in with the same ChatGPT account. Wait for **Saved to cloud** before switching devices. References, prompts, model configurations, results, and history are saved to an account-scoped R2 object. Conflicting changes from another device are rejected rather than silently overwritten.

GitHub stores the source code; the published site runs the app. Cloning this repository does not download your hosted workspace or credentials. GitHub pushes do not automatically update the hosted site.

## Current generation support

No provider is preconfigured. Add a model name, model ID, HTTPS gateway endpoint, and documented reference-image limit in the app. Your gateway must implement the contract below; arbitrary provider API URLs are not directly compatible.

Provider API keys belong on your gateway/server. The tester does not have an API-key field or store provider keys. The endpoint URL and model configuration sync across PCs. Endpoints must be accessible from the PC running the browser and allow CORS for the tester origin.

Four-image mode makes one request per model with `n: 4`. Describe desired views in your prompt. Front-first reference chaining is not implemented. Keep the generation tab open until results finish and show **Saved to cloud**.

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
- Provider keys, uploaded images, caches, and generated outputs are excluded from source control.

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

The app has built successfully. Storage tests cover save/read, stale revisions, account isolation, request-origin checks, and anonymous rejection using a fake bucket. Provider generation and syncing across two actual signed-in PCs still require live verification.
