# Team backend setup (Google Apps Script)

One script, owned by the team lead, replaces the Sites backend for the GitHub Pages tester:

- appends one row per model attempt to a Google Sheet (`records` tab: the 11 CSV columns plus a hidden `record_id`),
- saves reference and output images, `prompt.txt` and `record.json` into a Drive folder, using the same relative paths as the ZIP export,
- calls Seedream with the owner's Ark keys, so testers never see or enter a key,
- serves the judge API that `scripts/judge.mjs` and the `/judge` skill use.

Testers need nothing but the Pages URL. Humans review in the Sheet; Claude Code fills the **judge** column.

## 1. Create the script

1. Open <https://script.google.com> with the Google account that should own the data, and create a new project named `Image Model Tester backend`.
2. Replace the contents of `Code.gs` with [`Code.gs`](Code.gs) from this folder.
3. In **Project settings**, confirm the runtime is V8 (default).

## 2. Run `setup()` once

1. Select `setup` in the function dropdown and click **Run**. Approve the permissions (Drive, Sheets, external requests).
2. Open **Executions** or the log: it prints the Sheet URL, folder URL and the generated `SHARED_TOKEN`.

`setup()` creates the folder `Image Model Tester`, the Sheet `Image Model Tester — test records` inside it (headers, frozen row, plain-text format, hidden `record_id`, protected `judge` column), and the token. Running it again only fills in what is missing.

## 3. Set the Ark keys

In **Project settings → Script properties**, add:

| Property | Value |
| --- | --- |
| `ARK_KEY_PRO` | Volcengine Ark key with access to `doubao-seedream-5-0-pro-260628` |
| `ARK_KEY_FLASH` | Volcengine Ark key with access to `doubao-seedream-5-0-flash-260915` |

Use standard Ark keys. In the Ark console, give each key "自定义" permissions limited to its own model ID, so the Pro key can never be used for Flash and vice versa. All generations are billed to this Ark account.

## 4. Deploy as a web app

1. **Deploy → New deployment → Web app.**
2. *Execute as*: **Me**. *Who has access*: **Anyone**. (The shared token, not Google sign-in, gates requests.)
3. Copy the web app URL (`https://script.google.com/macros/s/…/exec`). Opening it in a browser should show "team backend is running".

After every later change to `Code.gs`, use **Deploy → Manage deployments → edit → New version**, so the same URL serves the new code.

## 5. Point the Pages site at it

Fill `public/google-config.js`:

```js
export const SCRIPT_URL='https://script.google.com/macros/s/…/exec';
export const SHARED_TOKEN='…from setup()…';
export const SHEET_URL='https://docs.google.com/spreadsheets/d/…';
export const FOLDER_URL='https://drive.google.com/drive/folders/…';
```

Then:

```bash
pnpm build:pages
```

Commit `docs/` and push. GitHub Pages republishes within a minute or two. The header shows **Team tester** with links to the Sheet and the folder instead of **Connect cloud**.

## 6. Share with the team

- Share the Sheet (and the folder, if testers should browse images) with the testers as **Editors** or **Viewers** from Drive.
- Reviewers type into **review**, **开源/闭源** and **tester**. The **judge** column is protected: only the owner and the Claude Code judge write it.
- Storage counts against the owner's Google quota (15 GB on a free account).

## How the columns are owned

| Column | Written by |
| --- | --- |
| paths, input, prompt, outputs, model used, status, test date | the tester's browser, through the script |
| review, 开源/闭源, tester | humans in the Sheet, or the tester's app when it has a value (last write wins) |
| judge | the Claude Code judge only (`/judge`) |
| record_id (hidden) | the script; never edit it |

## Judge API (used by `scripts/judge.mjs`)

All calls are `POST` with a JSON body `{token, action, …}` and a JSON reply `{ok, status, …}`.

| action | payload | reply |
| --- | --- | --- |
| `list` | `{limit}` | unjudged records with `status = done` and at least one output |
| `file` | `{path}` | `{name, mime, data}` (base64) for a path under the folder |
| `judge` | `{record_id, verdict, score, notes, model, rubric, force}` | writes the judge cell; refuses to overwrite unless `force` |
| `csv` | — | the 11-column CSV of the whole Sheet |

## Limits and caveats

- Apps Script executions stop at 6 minutes, and `UrlFetchApp` has no configurable timeout. Seedream at 1K normally answers well inside that, but a very slow generation will fail with a timeout message. If this happens often, move generation to a Cloudflare Worker and keep this script for records.
- A single `generate` call carries all references as base64 (the tester caps them at 10 MB each, 32 MB combined). Large batches are slow to upload from the browser; that is the same limit as before.
- Anyone who knows the script URL and token can append rows. The token is in the public page source, so keep the repository or at least the Sheet limited to the team, and rotate the token (change `SHARED_TOKEN`, rebuild Pages) if it leaks.
- Cells that start with `=` are stored with a leading apostrophe, exactly as the CSV export does, so prompts are never run as formulas. If you see a stray apostrophe elsewhere, report it; it means the plain-text format on the sheet was changed.
- Deleting a row in the Sheet does not delete its images. Deleting the Sheet or renaming the `records` tab breaks the backend until `setup()` is run again (which creates a new Sheet).
