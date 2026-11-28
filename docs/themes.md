# Themes

A person describes a look, for example "Spider-Man, Tom Holland". The API asks the existing Cloud Sophia model for a strict JSON theme and stores that JSON only.

The theme includes a name, one emoji, font weight, corner radius, an icon accent, light and dark palettes, and a wallpaper motif. Palettes cover primary, secondary, accent, background, surface, both bubble fills, and the text colors on each surface. The wallpaper is one of `gradient`, `dots`, `waves`, `grid`, `rings`, `rays`, or `diagonal`, plus two to four hex colors. Clients draw the pattern themselves. The model is instructed not to return logos, photographs, SVG, or URLs, and the server rejects those shapes.

## Contrast, limits, and gallery

Colors that miss WCAG AA are rewritten before the theme is saved. Body text must be at least 4.5:1. Accents and icon color must be at least 3:1. The generate response lists which fields changed.

`POST /themes/generate` allows 8 generations per user per hour, on top of the route limit. Prompts are capped at 180 characters, tweaks at 120, and the JSON body at 8000 bytes. A person can keep 40 themes. A basic content filter rejects prompts that ask for sexual content involving minors, slurs, or remote images.

Saved themes can be applied to the whole app or as a chat wallpaper. Publishing adds the theme to `GET /themes/gallery` without the private prompt. Gallery search matches the name. Anyone signed in can install, like, or report a theme. Three reports flag it, and a flagged theme leaves the gallery.

Without `SOPHIA_MODEL_API_KEY` or `SOPHIA_MODEL_BASE_URL`, generate still returns a theme. `source` is `mock`, and the palette is a hash of the prompt. "darker" and "lighter" only change luminance.

Apply the schema with `npx prisma db push` from `backend/`. The equivalent SQL is `backend/prisma/sql/20261128_themes_notifications.sql`. There is no Prisma Migrate history in this repo.
