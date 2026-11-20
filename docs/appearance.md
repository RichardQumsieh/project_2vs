# Adaptive appearance

Sophia can change how the app looks, and how drafts sound, without changing its code and without sending chat text off the device.

The feature is behind `NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED`. It is on unless that value is exactly `false`. Sophia can apply named themes from chat (for example Spiderman, or nature scenes that rotate on a timer) on this device only. Set the flag to `false` to disable.

## What is stored

Per user, in this browser:

- Design tokens in `localStorage` (`sophia-appearance:v1:<userId>`): color mode, accent, density, font scale, and a background id.
- A short history of those tokens and the draft voice, capped at 20 versions.
- Panel-open counts (`inbox`, `sophia`, `settings`, `integrations`). Counts only. No path query and no message text.
- The role the person picks: `manager` or `family`.
- Uploaded background bytes in a separate IndexedDB database, `sophia-appearance`. At most three images per user. PNG, JPEG, and WebP only, at most 1.5 MB, checked by magic bytes.

Signed-out use is stored under the id `device`. The preview route uses `preview` so it does not mix with an account.

## Tokens

`frontend/lib/appearance/schema.ts` is the strict schema. Unknown keys are rejected. Font scale is `0.875` to `1.25` in steps of `0.0625`. Backgrounds are `none`, one of four bundled gradients, one of four bundled patterns, or an upload id. A URL is not a valid background.

WCAG AA is enforced before a value can be saved:

- Page text against the theme background, and against the worst-case scrim over a background image, is at least 4.5:1.
- The accent against that background is at least 3:1 (interface graphic).
- Black or white text on the accent fill is at least 4.5:1.
- `system` color mode has to pass both the light and the dark palette, because the device can switch.

The scrim is 88% of the solid theme color. Contrast is checked against the remaining 12% mixed with pure white and pure black, so a photo cannot be the only thing behind the text.

## Suggestions

`proposeAdaptation` takes the current tokens, the current draft voice, and local signals: locale, hour, role, and panel counts. It returns one suggestion or nothing. The copy is a fixed catalog string, for example "Want a calmer evening theme?". Approving writes a version. Dismissing suppresses that rule for seven days. Undo drops the latest version. Reset writes the default tokens and the default voice.

Nothing in that function accepts chat plaintext. Extra fields on a signal object are rejected.

## Draft voice

Formal or friendly, short or detailed, and English, Arabic, or mixed. The default matches the previous English meeting draft, so leaving the preference alone does not change that sentence. Other combinations use fixed phrases on the device. They are not sent out for translation. When the flag is on, the same preference is appended to the on-device companion and suggestion prompts. When the flag is off, those prompts are unchanged.

## UI

Settings shows the entry only when the flag is on. `/settings/appearance` is the control. `/preview/appearance` accepts `hour`, `role`, and `panel` so tests can force a suggestion without waiting for the clock. Strings live in the i18n catalog, including Arabic, and the page follows the document direction.
