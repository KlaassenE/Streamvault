# Streamvault

A fresh self-hosted video library built with Next.js, React, TypeScript, selected shadcn-style Radix components, Lucide, and SQLite. Existing yt-dlp files stay in their original folders. This is a working first version for further design and hardware testing.

## Run on a new hosting device

Install Node.js 24 or newer and pnpm 11.19.0. No PHP, Laravel, Redis, external database, or paid service is required.

```sh
cd streamvault-next
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm build
pnpm start
```

Open `http://HOST:3000`. The first registered account becomes the administrator. Later registration is closed unless the administrator enables it. Add an absolute folder path in Library; it means a folder on the hosting device. For local development use `pnpm dev` and `http://127.0.0.1:3000`.

Keep `STREAMVAULT_DATA_DIR` on a persistent **local filesystem**. SQLite WAL should not live on an SMB/NFS share. Videos can be on a mounted drive. Keep the same data directory across restarts and upgrades; it contains user state and device sessions. Back up before upgrades.

### Docker option

Install Docker Engine and Compose on the host. In `.env` set `MEDIA_DIRECTORY=/absolute/path/to/videos`. Run `docker compose up --build -d`. The supplied configuration mounts original files read-only at `/library` and keeps the database in a named volume. Add `/library` in the app. The default published port is local to the host; use the example Nginx reverse proxy or an intentional LAN port binding.

Docker packaging is supplied but has not been run on the destination device. Ensure the container's `node` user can read the mounted files. Never delete the persistent volume to upgrade.

For HTTPS, set `STREAMVAULT_SECURE_COOKIE=true` and `STREAMVAULT_PUBLIC_ORIGIN=https://your-host.example` (include a non-default port if needed). Forward the original Host header. `deploy/nginx.conf.example` shows the proxy configuration. Keep the public-origin setting exact so progress writes and comments pass the same-origin check.

## What works

- Neutral dark/light gallery; an icon-only theme control; accessible phone hamburger drawer.
- For You, New to You, Continue Watching, Recently Added; vertical paginated grids, lazy artwork, distant-chunk unmounting, and per-tab grid restoration.
- A featured resume section occasionally, only when four eligible unfinished videos fill one feature and exactly three additional entries. Defaults: more than 15 seconds played, more than 30 seconds left, updated within 90 days; roughly every third home visit.
- Six-month personal-device sessions with daily rolling renewal when visible; logout, revocation, profile and password changes. Session tokens are opaque and only their hashes are stored. Password changes revoke every device session.
- Existing-folder indexing, scan jobs/progress, FTS search, channel pages, subscriptions, Watch Later, likes, archived/local comments and replies, watch history, playback preferences, administrator roles and registration policy.
- Protected native video streaming with Range/HEAD, ETags, request cancellation and backpressure. Supported files load only when Play is pressed. Original files are not uploaded, copied, rewritten, or transcoded during indexing.
- Chapters, VTT subtitles, playback rates, PiP/fullscreen, timestamp sharing, resume, optional autoplay, and player keyboard controls.
- Cmd/Ctrl+Z swaps the current position with the position before the last deliberate seek, including a chapter jump. Hold Space for 300ms to temporarily play at 2×; release restores the previous rate. Short Space toggles playback; arrows seek ±5s, 0–9 seek by percentage, Up/Down change volume, M/F/C mute/fullscreen/captions, `/` focuses search. Editable fields and dialogs keep normal shortcuts.

## yt-dlp indexing and preservation

Metadata is `*.info.json`; a media file and thumbnail share its basename. MP4/WebM are preferred, with M4V/MOV/MKV/AVI also discovered. Captions use `<basename>.<language>.vtt`; `-orig` is skipped. Playlist channel metadata and its local artwork apply within that folder's subtree. Arbitrary nested directories are scanned; hidden entries and symlinks are skipped. Plain videos without yt-dlp metadata are not indexed yet.

Stable source video/channel/comment identities are separate from filenames. Metadata is staged before an atomic reconciliation. Rescanning updates imported metadata, labels, chapters, and subtitles without replacing local discussion, reactions, watch progress, sessions, subscriptions, saved videos, preferences, or feedback. Imported comment reactions keep their namespace. Resolving a fallback uploader handle to a canonical channel ID carries subscriptions forward. Imported/local counts remain distinct.

Missing files become unavailable. An inaccessible drive, malformed metadata, or a completely empty metadata scan fails while keeping prior records. Folder archiving is reversible by adding the same folder again, and keeps original files and user data. Interrupted worker recovery allows re-indexing again. Duplicate source IDs keep the first discovered copy and report a warning; maintain one authoritative copy per ID.

```sh
pnpm scan /absolute/path/to/archive
pnpm scan ROOT_ID
pnpm backup /absolute/path/to/streamvault-backup.sqlite
```

The backup command uses SQLite's online backup API rather than copying a live WAL database. Back up the original archive and the app-owned `data/media` directory separately. CLI commands need the same `STREAMVAULT_DATA_DIR` as the server. Shell CLI processes do not automatically load `.env.local`; set it explicitly, for example `STREAMVAULT_DATA_DIR=/srv/streamvault/data pnpm scan /mnt/videos`.

## Playback compatibility

Container and codec compatibility depend on the browser. Indexing an MKV does not make its codecs playable. Optional FFmpeg copies are generated explicitly in the app-owned media directory:

```sh
pnpm compat youtube:VIDEO_ID
pnpm compat youtube:VIDEO_ID --transcode
```

The first command remuxes without re-encoding and adds fast-start metadata; the second converts video/audio to H.264/AAC. Set `FFMPEG_PATH` if needed. Copies are used only while their original-file fingerprint matches. Originals remain unchanged. Transcoding is CPU-intensive, so it never happens automatically when opening a tab. A compatibility-management UI and disk cleanup policy are still future work.

## Recommendation behavior

A lightweight deterministic ranker uses actual accumulated watch duration, likes, subscriptions, labels, recency, and exposure/completion penalties. Candidate pools include recent/resume videos, familiar interests, and older samples. Reranking penalizes repeated channels/topics, and every fourth eligible slot explores an unfamiliar channel. An explicit refresh changes the seed. Persisted snapshots keep ranked pages stable through cache eviction/restarts; after the ranked pool, pagination reaches the rest of the eligible library. Feedback offers Not Interested and Less From This Channel.

This is an inspectable starting algorithm; it does not claim to reproduce YouTube's private algorithm. Title/description similarity for untagged archives and calibration against your viewing habits remain useful next steps.

## Older computers and many tabs

Watch pages use a compact desktop player with suggestions alongside it. On phones, up to 30 suggestions appear before comments. Descriptions show a three-line preview until expanded. Navigation uses a compact desktop sidebar that expands on hover or keyboard focus; phones keep a hamburger menu. General, Library and User management settings share a tab row. Archived comment avatars and channel banner/avatar URLs are preserved during re-indexing; local channel artwork takes priority over remote URLs. Remote artwork loads directly with no referrer, and comment avatars fall back to initials when unavailable.

Watch pages render their essential metadata first. Comments and related suggestions load later and only in a visible viewport. Links disable automatic route prefetching. There are no hover video previews or global polling timers. Switching apps or tabs keeps active playback running. Already-paused hidden tabs save their position, then remove the source and call `load()` after one hour to release their media pipeline. Playing videos and PiP are not suspended. One-playing-tab behavior uses BroadcastChannel and can be disabled in Settings.

Native video does **not** offer an exact “keep only N seconds” buffer cap. Source removal releases browser-managed media resources; browsers decide remaining cache/decoder retention. Fifty-tab memory/CPU and time-to-first-frame need benchmarks on your real clients, codecs, storage and network. Shadcn/React alone is not a performance guarantee.

## Validation and current limits

```sh
pnpm typecheck
pnpm test
pnpm build
```

Eighteen core regression tests cover range requests, password/session lifetime, rescan state preservation, stale/idempotent progress, failed/offline/interrupted scans, canonical channel upgrades, duplicate IDs, scoped channel metadata, and stable diverse full-library pagination. Eight additional HTTP integration tests passed against the production demo: authentication, exact byte ranges/HEAD/ETags, and same-origin progress/session writes. Run them with `STREAMVAULT_DATA_DIR=./data/demo STREAMVAULT_TEST_ORIGIN=http://127.0.0.1:3000 pnpm test` while the demo server runs. Without those variables the HTTP suite skips cleanly. Local browser QA covers desktop/390px phone layout, hamburger navigation, themes, lazy row loading, synthetic H.264 playback, chapter/seek undo, speed restoration, a completed 72-entry scan from the interface, and staying signed in across a server restart. The development compiler uses webpack because this desktop's sandbox blocked Turbopack's local worker port.

The old Laravel app is untouched. Its feature inventory and approved design notes are in `docs/STREAMVAULT_ANALYSIS.md` and `docs/STREAMVAULT_DESIGN.md`, independent of the old source. There is no old-database migration command yet: preserve a backup/export of any old user state you want to migrate before removing it. Full legacy parity is not claimed: avatar uploads, channel search/autocomplete, administrator password reset/user deletion, richer end screens/theater mode and timeline chapter markers still need work. Automatic filesystem watching, import cancellation, thumbnails for missing artwork, and a deployment-specific Nginx X-Accel configuration are also pending. The importer stages all metadata in memory; very large comment archives should be benchmarked before increasing the current 32MiB-per-file limit.

## Disposable local demo

`STREAMVAULT_DATA_DIR=./data/demo STREAMVAULT_DEMO_VIDEO=/absolute/path/to/generated-test.mp4 pnpm demo` creates 72 synthetic metadata entries in `.demo-library` with a disposable demo account. Provide your own generated H.264/AAC test video. Artwork for the current local QA fixture is already generated. Start with `STREAMVAULT_DATA_DIR=./data/demo pnpm dev`; fixture sign-in is `demo@example.invalid` / `streamvault-demo-only`. Keep this demo on localhost and use a fresh database for the real server.


The Add and index button uses an entered hosting-device path immediately. With an empty path, local desktop access opens the hosting device's native folder chooser ([macOS](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/PromptforaFileorFolder.html), [Windows](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.folderbrowserdialog), or Linux with Zenity and a desktop session). Remote access, headless hosting, or `STREAMVAULT_NATIVE_FOLDER_PICKER=false` opens an administrator-only folder browser on the server. Both routes enforce `STREAMVAULT_ALLOWED_ROOTS`; selection indexes in place and does not upload files. Labels default to the folder name. Native Windows/Linux dialogs still require validation on their target platforms.


## Production updates without losing state

Use the same Compose project name on every deployment: `docker compose -p streamvault`. Its persistent `/data` volume contains the SQLite database, accounts, sessions, imported index, comments, likes, subscriptions, watch state and preferences. Keep the original video archive and its container mount path `/library` stable. Code/image replacements do not replace these volumes.

Before an update, create an online database backup and copy it outside Docker:

```sh
mkdir -p backups
docker compose -p streamvault exec streamvault node -e "require('node:fs').mkdirSync('/data/backups',{recursive:true})"
docker compose -p streamvault exec streamvault pnpm backup /data/backups/pre-update.sqlite
docker compose -p streamvault cp streamvault:/data/backups/pre-update.sqlite ./backups/pre-update.sqlite
```

Keep dated backups rather than overwriting your only copy. Also back up original videos/metadata and app-owned `/data/media` compatibility copies. Replace only application source with the updated release, preserving `.env`, `backups`, project name and volume. Then run:

```sh
docker compose -p streamvault up -d --build
docker compose -p streamvault logs --tail=50 streamvault
```

Never use `docker compose down -v`, delete the volume, or run demo seeding on production data. Keep the same browser-visible origin and HTTPS cookie settings to preserve existing sign-ins. Re-indexing is only needed for changed archive files; it preserves local user state. Future releases with incompatible database changes must include migration instructions; restore a pre-update database backup along with the matching previous application release when rolling back such a change.


## Local use without Docker

Docker and HTTPS are optional for use on your own computer or trusted local network. Install Node.js 24+ and pnpm 11.19.0, then run from this project directory:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm build
pnpm start
```

Open `http://localhost:3000` on the host, or `http://HOST-LAN-IP:3000` from your other computers. Leave `STREAMVAULT_SECURE_COOKIE=false` for local HTTP and leave `STREAMVAULT_PUBLIC_ORIGIN` empty to support both local addresses. Create the first administrator with email and password; the profile name is derived from the email and can be edited later. Subsequent registration follows the administrator's registration setting. Point Library at the real hosting-device folder path.

Keep the `data` directory and `.env.local` across updates. For data outside the code folder, set `STREAMVAULT_DATA_DIR` to an absolute persistent local path. Before replacing code, run `STREAMVAULT_DATA_DIR=/your/data/path pnpm backup /your/backups/pre-update.sqlite` (CLI commands do not read `.env.local` automatically). Stop the server, replace application files while keeping data/config/backups, run `pnpm install --frozen-lockfile && pnpm build && pnpm start`. No re-index is needed just for a code update. Use your OS's service manager to start it after reboot if desired.

## Git deployment

See [Git setup and production updates](docs/GIT_UPDATES.md) for first push, connecting an existing installation, and pulling updates without losing data. Home reloads use a fresh recommendation seed; pagination stays stable within the current mix.

## Channel URLs and Shorts

Channels use persistent readable slugs (for example `/channel/northbound`); duplicate names receive numeric suffixes. Legacy ID links redirect. Existing subscriptions and video IDs stay unchanged. Channel descriptions start as a three-line preview, and Videos/Shorts tabs paginate separately. Search includes matching channels with avatars and video counts.

Re-index existing folders once after this update to populate Shorts classification; local user state is preserved. Classification prefers an explicit `is_short` value, a YouTube Shorts URL, or a Shorts directory. Otherwise a square/portrait file up to three minutes is treated as a Short when dimensions and duration are available. This orientation fallback is a heuristic; archives lacking these fields cannot always be classified accurately. Shorts remain searchable and accessible in channel tabs, history and saved lists, but all home feed filters and the home resume section exclude classified Shorts.
