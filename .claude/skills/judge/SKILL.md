---
name: judge
description: Judge the unjudged image-tester records in the team Google Sheet against judge/rubric.md and write the verdicts back. Use when asked to judge, score, or grade generated test images, or when /judge is invoked.
---

# Judge the team test records

You are the AI judge for the image model tester. Records are rows in the team Google Sheet; images live in the team Drive folder. `scripts/judge.mjs` talks to the Apps Script backend for you. Your judgments go into the Sheet's **judge** column only.

## Procedure

1. Read `judge/rubric.md` in full. Note its version (the heading, currently `v1`). Score only with that rubric.
2. Pull a batch:
   ```bash
   node scripts/judge.mjs pull --limit 5
   ```
   The JSON lists each record's folder under `.judge/`, its `brief.md`, and the local `inputs` and `outputs` files. `remaining` tells you how many are still unjudged after this batch.
3. For each record, in order:
   - Read `brief.md` for the prompt, model, and the reference order.
   - View every input image with the Read tool, in order (Image 1 = `input-1-…`). Then view the output image(s).
   - Score the three rubric dimensions, add them, map the total to a verdict, and write notes in the rubric's format.
   - Submit, using your own model name so the Sheet records who judged:
     ```bash
     node scripts/judge.mjs submit <record_id> --verdict pass --score 4 --notes "…" --model "<your model name>" --rubric v1
     ```
4. Repeat `pull` until `remaining` is 0, or until the limit the user gave you.
5. Report a short table: path, model, verdict, score, one-line reason. Mention any record you could not open.

## Rules

- Judge from the images, never from the brief alone. If an image fails to open, submit `needs-review` with a note saying which file.
- Do not read, quote, or be influenced by the Sheet's human review column. It is not in the brief on purpose.
- One judgment per record. The backend refuses to overwrite an existing judgment unless `--force` is passed; pass it only when the user explicitly asks to re-judge.
- Do not edit `judge/rubric.md` during a judging session. Proposed rubric changes go in your report.
- Never generate images or call the Ark API. Judging is read-only apart from the judge cell.
- `.judge/` is a scratch folder (gitignored). Do not commit it.

## Configuration

`scripts/judge.mjs` reads `public/google-config.js`. To point at a different deployment, set `IMT_SCRIPT_URL` and `IMT_TOKEN` in the environment instead.
