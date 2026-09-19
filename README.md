# Count — Carldaris Sorter

A phone-first, offline-capable counter for bottles, crates, kegs and pallets.

## Run locally

Requires Node.js 20 or newer. No dependency installation or build step is needed.

```sh
node scripts/serve.cjs
```

Open http://127.0.0.1:4173. The preview server listens on this computer only.

For GitHub Pages, publish the repository root as a Pages site. Keep `index.html`, `src/`, `images/`, `icons/`, `manifest.webmanifest`, and `sw.js` together. The site URL will be your repository Pages URL, usually `https://<account>.github.io/<repository>/`; do not use the localhost preview address after publishing.

```sh
node --test tests/model.test.js
node scripts/audit-legacy.cjs
```

The first command runs rewrite acceptance tests. The second reproduces five issues in the archived original; it is a diagnostic script, not an acceptance suite. The package also defines `start`, `test`, and `audit:legacy` scripts for installations with working npm.

## Using the app

- Tap a photo to add one. Swipe horizontally to subtract one. Hold a tile, or tap its three-dot button, for direct quantity entry and the row multiplier.
- The bottom correction bar follows the selected item. Undo and redo retain the most recent 30 changes during the current page lifetime.
- **New count** preserves the current session and starts today's count with the same catalog. **Sessions** lets you return to earlier counts. **Clear this count** resets an existing session without changing its historical date.
- **More → Download backup** exports all sessions and preferences as JSON. **Restore backup** validates the data, asks for confirmation, and replaces current data; restore is undoable until reload. **Export this count** produces spreadsheet-compatible CSV.
- The tile details dialog contains **Edit**, including item deletion. Categories are managed from **More**. Reorder mode exposes touch and keyboard accessible arrows within each category.
- English, Latvian, Russian and Chinese are supported. Default names translate; custom names and category membership remain intact.

## Data and migration

Data lives on the current browser/device in `countlist.v4`. On first use, the old `countlist.v3` state is migrated without modifying that old key. Changing devices or clearing browser data requires restoring a JSON backup. There is no server, account or cloud synchronization.

Writes are synchronous and validated. A failed write leaves the previous displayed state intact and shows an error. Revision checks and storage events detect stale tabs; this is not a collaborative multi-user database. Use one active counting tab.

Malformed saved data opens a recovery dialog instead of being overwritten. Download the original stored text before replacing it. Imported backups are limited to 10 MB; browser storage quotas can be lower. Image imports preserve recognized local image paths and bounded PNG/JPEG/WebP data URLs; arbitrary remote URLs and SVG data are excluded.

## Offline installation and updates

Deploy the root HTML, `src/`, `images/`, `icons/`, manifest and service worker together on an HTTPS static host. The existing relative paths support a repository subdirectory such as GitHub Pages. No deployment was performed as part of this rewrite.

The service worker precaches the complete app and catalog images as one release. An update waits for the user to choose **Reload to update**. Bump the release identifier in `sw.js` whenever any app asset changes. Only caches owned by this app scope are removed.

Service worker registration is disabled in normal localhost previews to avoid stale development assets. Open `/?offline-test` to enable it for an offline test. That registration persists for the origin; use the browser's site-data controls after testing if continuing development on the same origin.

Voice counting depends on browser speech recognition, microphone permission and potentially an internet connection. The app does not promise offline voice recognition. Say a full item name to select it, then a command such as “plus five.” Ambiguous names are rejected. Actual microphone recognition still needs testing on the target phone.

## Source layout

- `src/model.js`: catalog migration, validation, count/session commands and CSV serialization.
- `src/storage.js`: validated persistence, revision checks, undo and redo.
- `src/app.js`: accessible dialogs, rendering, pointer input and browser integrations.
- `src/catalog.js`: existing default catalog, images and translations.
- `src/strings.js`: additional interface translations.
- `src/voice.js`: speech command interpretation.
- `src/styles.css`: responsive presentation and themes.
- `tests/model.test.js`: data integrity and offline asset tests.
- `legacy/index.html`: original app snapshot, with a base URL added so its existing assets resolve from this folder.
- `docs/APP-AUDIT.md`: findings, rewrite decisions and validation scope.

The old animation galleries and reference images remain available. The legacy page uses the original v3 data key; changes made there after migration are not automatically merged into v4.
