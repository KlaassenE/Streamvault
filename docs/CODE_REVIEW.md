# Code review — 7 October 2026

Reviewed authentication and settings, indexing/reconciliation and scan workers, API authorization, media/range delivery, recommendations and pagination, player lifecycle, comments, navigation, folder selection, and deployment/backup paths.

## Fixes

- Email/password-only registration with unique names derived from email; login links to account creation. Existing administrator registration controls remain enforced.
- Explicit auth placeholders with readable light/dark colors.
- Profile email normalization and atomic password/session updates.
- Seek checkpoints wait for media readiness; completed videos can be replayed; explicit `t=0` overrides resume; unknown duration preserves explicit timestamps.
- Caption state survives metadata loading, native pause/mute changes stay synchronized, and shortcuts avoid focused buttons/links.
- Cached grids invalidate after indexing and refresh progress without changing recommendation order; watched/reset actions update the visible grid.
- Scan workers record their PID immediately, recover interrupted jobs, and release failed scans. Archiving an actively scanned root is rejected.
- Fractional pagination offsets are normalized instead of causing SQLite errors.
- Theme/feed/session persistence tolerates unavailable browser storage. Visible sessions renew daily even without a visibility change.
- CLI indexing recognizes Windows absolute folder paths.

## Validation and limits

Production build, TypeScript and 15 core regression tests passed. Four HTTP integration checks cover authenticated media, range/HEAD/ETag delivery, same-origin writes, and host folder browsing.

The old Laravel application remains untouched. This review does not guarantee absence of all bugs. Large-library/50-tab resource use needs testing on the intended hardware. Native folder dialogs need validation on the destination OS; Docker packaging has not been executed there. Legacy database migration remains separate work.
