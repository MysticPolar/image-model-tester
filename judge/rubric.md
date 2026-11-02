# Judge rubric — v1

Used by the Claude Code `/judge` skill to fill the **judge** column of the team Sheet. Every judgment records this version (`rubric v1`) so later changes to this file never silently re-score old records. To change the scoring, copy this file to `rubric-v2.md`, update the skill, and bump the version.

## What the judge sees

- The prompt, exactly as the tester typed it.
- The reference images in the tester's order (Image 1, Image 2, …). The prompt may refer to them by number.
- The output image for this record (one image per Seedream request).
- The model name. The judge does not see the human review and must not look for it.

## Scoring (0–5, in 0.5 steps)

Score three things, then add them up.

| Dimension | Points | 0 | Half | Full |
| --- | --- | --- | --- | --- |
| **Prompt adherence** | 0–2 | Ignores the main instruction (wrong subject, action, or scene) | Main instruction followed, a secondary detail missed or wrong (count, colour, text, position) | Everything the prompt asks for is present and correct |
| **Reference fidelity** | 0–2 | The referenced subject, product, or style is not recognisable | Recognisable but with clear drift (face, proportions, logo, pattern, palette) | Faithful to the references in identity, proportions, and style |
| **Image quality** | 0–1 | Severe artifacts: broken anatomy, garbled text, duplicated limbs, heavy blur | Minor artifacts only visible when zoomed | Clean, coherent, correctly exposed, no artifacts |

Rules of thumb:

- Reference fidelity applies only when the prompt relies on references (“Image 1 holding Image 2”, “in the style of Image 3”). If the references are mood-only, judge fidelity by whether the mood carried over and say so in the notes.
- Text in the image is part of prompt adherence: misspelled or garbled text costs at least half a point.
- Watermarks are expected (the request sets `watermark: true`) and are never penalised.
- The 9:16 portrait format is set by the request, not the model. Do not score it.
- Do not reward extra polish the prompt did not ask for, and do not penalise a plain result that does exactly what was asked.

## Verdict

| Total | Verdict |
| --- | --- |
| 4.0–5.0 | `pass` |
| 2.5–3.5 | `needs-review` — a human should decide |
| 0–2.0 | `fail` |

Use `needs-review` also when the judge cannot open an image or the prompt is ambiguous enough that two reasonable readings give different scores. Say which in the notes.

## Notes format

One to three sentences, at most 60 words, in English. Lead with the decisive observation, name the dimension it affected, and refer to references by number (“Image 2”). Example:

> Subject and pose match the prompt, but the jacket pattern from Image 2 became a plain fabric (fidelity −1). Hands are clean; small text on the badge is garbled (quality −0.5).

No praise without a reason, no speculation about the model's internals, no suggestions for new prompts.
