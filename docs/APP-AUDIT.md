# App review and first rewrite

Reviewed September 19, 2026. Source inspected: original `index.html` (about 3,460 lines), service worker, manifest, asset inventory and animation galleries. The user confirmed the primary workflow is an installed/opened website on a phone.

## Existing functionality

The original is a static progressive web app. A single HTML file combines presentation, four translation dictionaries, mutable application state, migrations, touch gestures, drag layout, settings, CSV/HTML exports and speech recognition. There is no backend, package configuration or automated test suite in the original snapshot.

The useful core is rapid visual counting: tap +1, horizontal swipe −1, long press for details, direct numeric entry and a rows-times-units multiplier. The catalog covers empty crates, crates with bottles, kegs and pallets. Category subtotals, a grand total, custom categories/items, rearrangement with gaps, four languages and detailed display settings are present.

## Findings in the original

| Finding | Evidence in archived source | Consequence |
| --- | --- | --- |
| Storage failure is only logged | `save()` catches `setItem` failure and still advances `savedAt` | Counts appear accepted although not durable |
| Translation mutates catalog identity | `localizeDefaults()` overwrites default names/categories and renames the categories array, but leaves custom items on old category strings | User edits can be lost; custom items can disappear from the rendered groups |
| Stored items are not validated | `load()` checks the items array but not individual records/quantities | String quantity `"5"` increments to `51`; malformed records can break startup |
| No count-session model | `resetAll()` clears quantities and label but keeps `state.date` | Starting another day's work can retain an old report date |
| Voice zero is replaced with one | `extractNumber(rawText) || 1` | “Plus zero” increments by one |
| Offline precache misses one catalog image | Original `PRECACHE` omits `crateGrnGarage.webp` | A first offline visit can lack that photo |
| Service worker deletes unrelated caches | Activation deletes every cache whose name differs from `count-v1` | Other apps sharing the origin can lose offline assets |
| Item editor is not reachable for existing items | `openEditor(id, 'item')` exists, but its visible callers only add items or edit categories | Existing item customization is inaccessible through the rendered controls |
| Full grid rebuilt for ordinary taps | `bumpItem()` calls `render()` | Unnecessary DOM work and loss of element/focus continuity |
| Counting controls are pointer-only divs | `makeTile()` creates divs; custom overlay dialogs lack native focus behavior | Keyboard and assistive-technology access is weak |
| HTML export is not self-contained | Saved HTML keeps relative image/manifest/icon references | Sharing the HTML alone loses its external assets |
| Categories are user-visible strings used as keys | Membership is `item.category === category` | Renaming and translation couple labels to data relationships |

Five behavioral findings are reproducible with `node scripts/audit-legacy.cjs`, using extracted original functions and synthetic data. The original missing-image precache was also checked before replacement; the rewrite acceptance suite checks that this image and all app modules are now included.

## Rewrite implemented

The replacement keeps a static, dependency-free deployment while separating domain commands, persistence, UI, translations, speech parsing and styles. Existing catalog images and translations are reused; the application structure, model and UI are rewritten.

Stable IDs separate category membership from translated labels. Explicit schema validation checks restored state. Legacy migration retains the v3 storage key, fixes missing category references, resolves duplicate item IDs and normalizes invalid quantities. Malformed top-level saved data triggers recovery rather than automatic replacement.

Count operations update existing tiles and totals. Native buttons and a native dialog provide keyboard interaction and modal focus containment. The phone interface adds a correction bar, search, visible editing, count progress, undo/redo and session history. A zero explicitly checked is distinct from an untouched item.

Session creation copies the catalog, starts at zero, uses a local calendar date and keeps the previous session. Clearing a historical session deliberately retains that session's date. CSV export escapes quotes and neutralizes formula-leading text. JSON backup/restore replaces HTML cloning as the data-transfer workflow, consistent with the user's phone website usage.

The new service worker precaches one coherent release, waits for user-triggered update activation, and deletes only caches belonging to this app scope. Localhost development does not register a worker unless `offline-test` is requested.

## Deliberate changes and limits

- HTML snapshot export becomes JSON backup/restore plus CSV reports. The original app snapshot remains in `legacy/` for reference.
- Reordering is a grid layout tool. Enabling it squares every cell and pads the final row with empty slots; a tile can be dragged onto any cell, moving freely and leaving a persisted gap behind, or swapping with an occupied cell. Gaps are removable by tapping and repositionable by dragging. Explicit arrows remain for keyboard access. This replaces the original drag algorithm while preserving imported spacer entries and now exposing new blank layout slots.
- Row-fit settings control approximate tile density; they do not promise that the entire catalog and all category headings fit in a fixed number of viewport rows.
- Undo/redo is in memory, bounded to 30 changes, and resets on reload. Session history is persisted.
- Data is device-local. Revision checks detect stale tabs but do not provide multi-device synchronization or atomic collaborative editing across simultaneously writing tabs.
- Voice uses the browser's existing speech API. Parsing is tested; microphone permission, actual speech recognition and installed iOS/Android behavior require checks on the intended device. English/Latvian/Russian number handling is intentionally limited to the supplied vocabulary; it is not a general natural-language number parser.
- Core interface text is translated; some diagnostic messages and secondary accessibility labels remain English.
- New custom images cannot yet be uploaded through the editor. The original visible editor also lacked an image-upload control; safe embedded images in older data are retained by migration.

## Validation

Automated tests cover legacy migration, language/category integrity, quantity constraints, immutable count changes, session history/local dates, checked-zero semantics, category deletion, malformed backup rejection, CSV safety, legacy-key preservation, write-failure rollback, undo/redo, stale-tab detection, grid placement/gap removal, voice zero/ambiguity and precache completeness.

Browser checks cover initial rendering, tap counting, bulk addition, undo, session creation and switching, adding a custom item, language switching, persistence across reload, and a narrow phone viewport. Product images load successfully, the phone page has no horizontal overflow, and the inspected browser error log is empty.

No changes have been pushed or deployed. Physical-device touch behavior and microphone recognition should be validated before treating this as a production release.

Final verification: 16 automated tests pass. With the preview server stopped, the installed app reloaded successfully, all images remained available, and counting continued. The user-triggered service-worker update flow was exercised successfully. A synthetic JSON backup was restored through the actual browser file picker and confirmation dialog; its quantity of 12 appeared correctly. Three-column phone density applied without horizontal overflow. The delivered local preview contains only a cleared synthetic session named Preview count.
