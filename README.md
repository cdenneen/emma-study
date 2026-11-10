# Emma Study

Emma's study app (GitHub Pages) with a parent progress view. Content, progress, and course grades live in a Supabase backend — this repo holds only the pages and PWA assets.

## Layout

- `index.html` — Emma's study app (quizzes, flashcards, Cold check, Focus next, Reminders).
- `parent/index.html` — parent view (aggregates only, never raw answers).
- `sw.js` — service worker. It MUST stay at the repo root: a worker's scope is its own directory, so moving it into a subfolder breaks push notifications.
- `assets/` — PWA manifest (`manifest.webmanifest`) and app icons.

## Publishing rules

- The pages must reference the manifest and icons with plain relative URLs (`assets/...`). Embedded data-URI links are ignored by iOS for Home Screen icons.
- Every page publish that changes behavior must ship with a service-worker cache bump (`CACHE_NAME` in `sw.js`), or installed apps keep serving the old shell.
- Day-to-day content and grade updates happen in the backend database and need no publish.
