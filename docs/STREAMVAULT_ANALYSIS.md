# Streamvault: existing features and rebuild review

Reviewed 7 October 2026. This document is saved outside the old `streamvault` directory so the requirements remain available after that directory is deleted. It describes existing behavior independently of the source code. Recommendations are proposals for review, not an approved implementation plan.

User-confirmed priorities during this review: yt-dlp indexing is the most important feature; re-indexing must preserve local comments, watch state, subscriptions, likes, and other user state wherever possible. The intended frontend uses lightweight React/TypeScript with Next.js, selected shadcn/ui components, and Lucide icons.

## Findings that matter most

- Persistent login is not implemented end to end: the login form sends no `remember` value, sessions have a configured 120-minute idle lifetime, and the users table has no `remember_token` column.
- Recommendations use subscriptions, tags/categories from the last 20 history entries, popularity, and random noise. They have no explicit diversity, exposure, completion, or discovery rules.
- Video range requests are served by a PHP loop reading and flushing 8 KiB at a time. The watch page also performs substantial work before the browser can start the player. These are plausible performance contributors; actual playback latency has not been measured.
- Players have no inactive-tab lifecycle. They attach their media source immediately and attempt playback after metadata loads.
- Re-indexing deletes existing videos and comments before rebuilding them, including locally written comments. Imported and local engagement counts are mixed.
- The core library workflow is worth preserving: use existing files in place, import rich yt-dlp metadata, and retain player conveniences.

The bundled database contains 19 channels, 3,492 videos, 61 history records, and 1,737 chapters. There are no stored comments or subtitles in this snapshot, although both features exist in code. 1,826 videos have tags; all 3,492 have categories. Eleven video records have no media path. These are snapshot counts, not a claim about the current contents of the original media folders.

## Existing application and pages

The application uses Laravel 12 / PHP 8.2+, SQLite, Inertia, React 19, TypeScript, Vite, and Tailwind 4. It already has a React/TypeScript frontend. Icons are hand-written SVGs, with some emoji in admin pages. No shadcn/ui or Lucide dependency is present.

| Page / area | Existing behavior |
| --- | --- |
| Home | Forty recommendations; personalized category/tag chips; toggle chips off in preferences; filtering returns up to 80 videos; responsive video grid. |
| Watch | Custom player; title/channel information; subscribe and like; expandable description; linked tags/categories; recommendations with progress; comments/replies; autoplay toggle. |
| Channel | Banner, avatar, imported follower count, description excerpt, subscribe, newest-first videos, 24 videos per page. |
| Search | Video title/description and channel name/description search; All/Videos/Channels tabs; up to 100 videos and 20 channels; popularity ordering. |
| Search box | 300 ms debounce, cancelled previous requests, video/channel suggestions, keyboard selection, eight recent searches stored locally, remove individual recent searches. Selecting a video suggestion currently searches its title instead of opening it. |
| History | Newest-first viewing records, thumbnail progress, percentage and saved position, 30 records per page. Logged-out explanation. |
| Subscriptions | List of subscribed channels, follower/video counts, links to channel pages. This is not a feed of videos from those channels. |
| Login / registration | Email/password login, username/email registration, password confirmation, automatic login after registration, first registered account becomes administrator. |
| Profile / settings | Username/email update; profile image upload up to 2 MiB; change password; preferred subtitle language; show/hide home chips. |
| Appearance / navigation | Light/dark modes, initial system preference, Default and Brutalist themes, collapsible navigation, mobile search, account menu, flash messages. Theme choices are primarily restored from browser local storage. |
| Admin overview | Counts of channels/videos/users and an approximate watch-time statistic, plus management links. |
| Admin channels | Add an absolute server-side folder path, synchronous indexing, manual re-index, remove channel records without deleting video files. |
| Admin users | List accounts, promote/demote administrators, set another user's password, delete accounts; cannot delete your own account. |
| Admin settings | Require login to browse pages. |

Not currently implemented: playlists, Watch Later, playback queue, a dedicated Continue Watching section, recommendation feedback, impression tracking, automatic rescans, a folder browser, video uploads, downloading from YouTube, actual live broadcasting, quality switching, picture-in-picture controls, theater mode, transcript search, user-managed device sessions, and self-service email password recovery. A metadata `LIVE` badge and imported playlist-type channel metadata do not provide live streaming or user playlists.

`site_name` and `allow_registration` are seeded settings, but the application does not use them to customize its name or restrict registration.

## Player behavior to preserve

| Interaction | Existing behavior |
| --- | --- |
| Click player / short Space press | Play or pause. Space toggles on key release. |
| Hold Space | After 300 ms, play at 2×; release restores the previous speed. If it was paused, holding starts playback and release does not restore the paused state. |
| Cmd+Z / Ctrl+Z | Return to the position before the last tracked seek. Repeating the shortcut swaps between the two positions; it is not a multi-step undo stack. |
| Timeline drag | Save the position at pointer-down for seek undo. |
| Left / Right | Seek backward / forward five seconds and save the previous position for undo. |
| 0–9 | Jump to 0–90% of the video, with seek undo. |
| Up / Down | Change volume by 10%. |
| M / F / C | Mute; fullscreen; captions toggle. |
| Double-click | Fullscreen toggle. |
| `/` | Focus search, or open mobile search. |
| Speed menu | 0.25, 0.5, 0.75, 1, 1.25, 1.5, and 2×. |
| Chapters | Timeline markers and current chapter title; clicking a marker seeks and starts playback. Chapter jumps currently do not update seek undo. |
| Subtitles | Local VTT tracks; language selection and Off; preferred language, then English, then first available track. A sole subtitle track is selected regardless of language preference. |
| Resume | Load the last saved position if it is more than zero and earlier than five seconds before the end. Otherwise begin at zero. |
| History saving | Every five seconds during playback. No explicit save on pause, seek, completion, tab hiding, navigation, or closing. |
| Controls | Hide after inactivity while playing; show on pause, pointer activity, or seeking; loading indicator and buffered indicator. |
| Autoplay | Local browser preference, enabled by default; first recommendation is next; eight-second countdown with Play Now and Cancel; overlay works inside fullscreen. |
| End screen | With autoplay disabled, show three recommendations, or nine in fullscreen, and Replay. |

For the rebuild, keep the distinctive shortcuts and make every deliberate seek undoable, including chapters. A bounded undo/redo history would be an optional extension. Shortcuts should respect editable fields, dialogs, and normal browser commands. Preserve an explicit background-audio/PiP option when adding tab suspension.

## Folder import contract

The old importer is a yt-dlp archive importer, not a general recursive video scanner.

1. An administrator types a path on the hosting device. It is not a folder picker on the viewing computer.
2. It looks for a `*.info.json` channel metadata file with `_type: "playlist"` and `channel_id` or `uploader_id`, either directly in that folder or in one immediate subfolder.
3. Channel identity falls back to the folder name when channel metadata is absent. The database primary key uses `uploader_id` when available, while videos/subscriptions link using `channel_id`.
4. Video directories are immediate subfolders whose names start with eight digits. Metadata found in a subfolder does not change the root used for finding video directories.
5. Each video directory needs a `*.info.json` file with an `id`. Playlist entries and invalid/missing metadata are skipped.
6. Media and artwork must share that metadata file's basename after removing `.info.json`. Media discovery preference is MKV, MP4, MOV, AVI, then WebM. Thumbnail preference is WebP, JPG, PNG, then JPEG.
7. Metadata imports title, description, original dates and counts, tags, categories, archived comments, chapters, and availability/live/media flags.
8. Captions must be named `<basename>.<language>.vtt`; language codes are normalized to lowercase, and `-orig` variants are skipped. SRT is not supported.
9. Channel artwork is `<channel-basename>.<image-extension>` and `<channel-basename>_banner.<image-extension>`. A missing banner can be downloaded from metadata and written into the source folder. Another fallback downloads a YouTube default banner on request.
10. Indexing stores file paths and uses the existing video files. It does not copy or transcode them. Missing video files can still produce indexed records.

Re-index runs inside an HTTP request and first deletes the channel's video metadata. There is no automatic watcher/scheduler, job progress, cancellation, incremental file fingerprint, mount health check, or reconciliation of moved files. A failed re-index can leave the library partially rebuilt. Its success count measures candidate directories, not necessarily successfully imported videos.

Required improvement: make this yt-dlp archive format a first-class, thoroughly verified import path. Re-index metadata incrementally using stable source video/channel/comment identities; preserve local comments and replies, their local likes, watch progress/history, subscriptions, video likes, settings, and future user-owned data. Imported comments should be updated independently of local comments and keep stable identities for local reactions. Interrupted or failed scans must leave the previous usable library intact. Missing files should be marked unavailable rather than triggering deletion of user state; an offline drive must not be treated as a mass deletion. Removal of a library entry and permanent erasure of user data should be separate operations.

Proposed improvement: add library roots independently of channels. Support for arbitrary layouts and filename/media-probing fallback is optional and secondary to yt-dlp compatibility. Keep originals read-only. Store generated thumbnails, compatibility copies, and cached artwork in an application-owned cache. Preserve identities through rescans and folder moves.

Re-index acceptance checks: import a representative yt-dlp archive; create local comments/replies/likes and watch/subscription state; modify imported metadata and add/move files; rescan repeatedly and verify all user state survives. Also exercise failed/interrupted scans, duplicate IDs, changed uploader handles, and offline mounts. A scan must not create duplicate videos/comments or reset imported/local engagement by conflating the two.

## Complete existing model inventory

There are 14 application models. IDs are strings unless indicated otherwise. Most dates are integer Unix timestamps in seconds; upload dates are yt-dlp-style date strings. The following field list captures the current schema so it does not require retaining the old source.

| Model | Key and fields | Relationships / meaning |
| --- | --- | --- |
| User | `id` primary; unique `username`, unique `email`, `password_hash`, `profile_picture`, `is_admin`, integer `created_at` | Has history, subscriptions, video/comment likes, settings. No persistent-login token. |
| Channel | `id` primary; unique `channel_id`, `channel`, integer `channel_follower_count`, `description`, `profile_image`, `banner_image`, `folder_path`, integer `indexed_at` | Has videos using `channel_id`. Two different channel identifiers need care. |
| Video | `id` primary; `title`, `channel_id`, integer `view_count`, `description`, `live_status`, `media_type`, `upload_date`, integer `timestamp`, `availability`, integer `like_count`, integer `comment_count`, `video_path`, `thumbnail_path`, integer `duration`, integer `indexed_at` | Belongs to channel; has tags, categories, comments, chapters, subtitles, history. Duration is seconds. |
| Tag | Composite primary key `(id, text)` | `id` means video ID, not tag ID. One text label per video. |
| Category | Composite primary key `(id, text)` | Same structure as Tag; `id` means video ID. |
| Chapter | Composite primary key `(video_id, start_time)`; `title`, floating `start_time`, floating `end_time` | Belongs to video; times are seconds. |
| Subtitle | Composite primary key `(video_id, language)`; `file_path` | Belongs to video. |
| Comment | `id` primary; `video_id`, nullable `parent`, `text`, integer `like_count`, `author_id`, `author`, `author_thumbnail`, `author_is_uploader`, `author_is_verified`, `author_url`, `is_favorited`, integer `timestamp`, `is_pinned`, `source` | Belongs to video; replies link through `parent`; has comment likes. `source` separates `ytdlp` and local `user` comments. Imported authors need not have local accounts. |
| History | `id` primary; `user_id`, `video_id`, integer `watched_at`, integer `progress`, floating `progress_seconds` | Belongs to user/video. Percentage is 0–100. Updates the latest record when it was touched within 30 minutes; otherwise creates another history record. |
| Subscription | Composite primary key `(user_id, channel_id)`; integer `subscribed_at` | Links user/channel using the channel's external ID. |
| VideoLike | Composite primary key `(user_id, video_id)`; integer `created_at` | Local user's video like. |
| CommentLike | Composite primary key `(user_id, comment_id)`; integer `created_at` | Local user's comment like. |
| Setting | `key` primary; text `value` | Global configuration. Used: `require_login`; seeded but unused: `site_name`, `allow_registration`. |
| UserSetting | Composite primary key `(user_id, key)`; text `value` | Allowed keys: `dark_mode`, `theme`, `show_chips`, `preferred_language`. The frontend also stores autoplay, theme, and recent searches locally. |

Infrastructure tables: `migrations`, `sessions` (session ID, optional user/IP/user-agent, payload, last activity), `cache`, `cache_locks`, `jobs`, `job_batches`, and `failed_jobs`. These are framework infrastructure, not additional product features. The configured database queue exists but indexing does not dispatch jobs to it.

The application tables have primary/unique keys but no declared foreign keys or the main browsing/history/comment indexes. Read-only SQLite query plans confirm that the user/video resume query and video comment query scan their tables and use temporary sorting.

Suggested model changes for review:

- Keep accounts, channels, videos, chapters, subtitles, comments, subscriptions, likes, and preferences as product concepts.
- Add `LibraryRoot`, `MediaAsset`, and `ScanJob` to separate filesystem discovery, playable files/derivatives, and background work.
- Add durable `DeviceSession` records for long-lived login and revocation.
- Separate `WatchProgress` (one latest position per user/video) from `WatchSession` or bounded `PlaybackEvent` records (actual engagement). Seeking to minute 50 does not mean watching 50 minutes.
- Add `FeedImpression` and `RecommendationFeedback` for recently shown videos, dismissals, channel preferences, and repeat avoidance. Only count impressions actually visible to the user.
- Separate imported engagement counts from local views/likes/subscribers so rescanning never overwrites user activity.
- Use stable internal identities plus optional source identities; distinguish date published from date added to this library. Store actual file availability, container, codecs, dimensions, bitrate, and compatibility status.
- Optional additions: `Playlist`/`PlaylistItem`, `WatchLater`, and timestamp bookmarks.

## Diagnosis and proposed fixes

### 1. Staying logged in for months

Confirmed: this copy configures database sessions with a 120-minute idle lifetime. Login receives only email/password, even though the backend reads a `remember` flag. Registration also uses ordinary login. The actual users schema lacks a remember-token column. Thus the current persistent-login path is incomplete. This explains recurring login prompts, although the exact timing on the old deployment was not reproduced.

Proposed behavior: persistent login by default on personal devices, with an explicit temporary-session option. A rolling 180-day device session is a reasonable initial proposal. Use an opaque cookie with its token hashed in the database, appropriate cookie protections, expiry/renewal, and revoke controls. Persist the database and signing/encryption secrets across upgrades/reboots. Throttle renewal writes rather than touching every session on every media request. Multi-tab renewal must not invalidate another tab's session accidentally. Password resets and explicit logout should have defined revocation behavior.

Acceptance: sessions survive closing/reopening the browser, server restarts, deployment, and long inactivity within the agreed lifetime; logout/revocation still work. A background tab does not need polling simply to remain logged in.

### 2. Recommendations with familiarity and discovery

Current score is subscription bonus (+3), matching tags (+2 each), matching categories (+2 each), a popularity threshold bonus (0–3), and noise (approximately -2 to +2). The code comment mentions capped tag overlap, but the implemented score does not cap it. It uses 20 history rows, which can include repeated watches of the same video. Anonymous ordering is popularity first, randomness only for ties.

The score ignores local likes, actual watch duration, skips, completion, how often something has been shown, and long-term interests. Completed videos can keep returning. Resume data is drawn on cards after ranking; it is not a resume candidate strategy. The watch sidebar uses the same user feed, excluding the current video, rather than matching the current video's subject. Popularity-heavy and tag-heavy videos can dominate.

We can aim for the qualities you liked in 2022 YouTube without claiming to reproduce its proprietary algorithm. Proposed lightweight approach: retrieve several candidate pools, then rank and diversify them together. Start with a reviewable mix such as:

| Candidate pool | Initial share |
| --- | --- |
| Familiar interests and subscriptions | 45% |
| Adjacent subjects and less-watched channels | 25% |
| Newly added, unseen library videos | 15% |
| Unfinished videos worth resuming | 15% |

These are tunable starting weights, not guaranteed quotas; pools overlap and small libraries need fallbacks. Preserve a range of topics and video lengths, limit consecutive videos from the same channel, apply cooldowns to recently seen/completed items, allow intentional rewatching, and distinguish browsing novelty from recent publication. Use actual engagement, both recent and older interests, with diminishing returns so one binge does not monopolize the feed.

A feed should remain stable while browsing and gain variety on explicit refresh. Home and Up Next should have different goals. Feedback controls could include Not Interested, Less From This Channel, More Variety, and a short recommendation reason. Cache a bounded pool server-side and do inexpensive reranking; a heavy AI service is not necessary for the first version. Title/description similarity can help when tags are absent. Optional offline embeddings can be evaluated later against simpler matching.

Acceptance: repeat/channel/topic exposure is measurable, resume items appear reliably, completed videos do not dominate, different interests survive a binge, and missing tags/cold-start users still receive a useful mix.

### 3. Faster video loading

Confirmed code-level contributors and gaps:

- Range requests occupy the PHP application stream loop with frequent small reads/flushes. A normal open-ended range can extend to the end of the file; it does not necessarily mean the browser will download all of it.
- Malformed, suffix, and unsatisfiable ranges are not handled correctly by the custom parser; there is no explicit 416 path.
- Before returning a watch page, the controller loads metadata, 50 top-level comments, every reply to those comments, recommendations, engagement flags, and history. Replies are limited only in the interface, after transfer.
- Comments appear twice in the page data, and two independent responsive comment trees mount. Hidden markup does not eliminate its React state or processing.
- Recommendations fetch complete video records, including descriptions and server filesystem paths, when cards only need a few fields.
- Thumbnails/avatars have no lazy-loading attributes in the main card components. Missing banners can trigger a remote request.
- The player sets `src` immediately and has no explicit preload policy, compatibility probing, alternate rendition, or player error UI.
- Discovery recognizes containers by filename extension, which does not establish browser or old-device codec support. MKV wins over MP4 when both exist.

PHP/Laravel itself is not proven to be the cause. Disk/network speed, media format, decoder support, original server setup, and browser behavior still need measurements.

Proposed architecture: let Next.js authorize access and return page metadata, while a file-serving layer handles byte delivery. Nginx internal redirects are one practical option for retaining access control while offloading bytes. This is an architectural recommendation supported by its [internal-location documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html#internal).

Prefer direct playback for compatible originals. When needed, create a cached compatibility file without altering the original. Remux compatible streams before considering re-encoding. MP4 fast-start places the file index near the beginning; [FFmpeg documents this option](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv). Inspect real codecs and hardware support before selecting formats/resolutions. Avoid launching a live transcode for every tab.

Return the player shell and essential metadata first; load comments/recommendations independently; paginate replies at the server; use compact card payloads, appropriate indexes, cached image variants, and meaningful cache validators. Protect streams when private browsing is enabled; the old media endpoints bypass the login requirement.

Acceptance: measure time to first frame, seek recovery, stalls, media throughput, application latency, and server/client CPU on the target hardware. Use representative local, network-mounted, and incompatible files. Agree thresholds after establishing a baseline; do not promise a startup time without that evidence.

### 4. Fifty tabs on older computers

The target should be one playing tab plus many inexpensive idle tabs. Fifty simultaneously decoding videos is a fundamentally different workload and should not be treated as the normal acceptance case.

| Tab state | Proposed behavior |
| --- | --- |
| Opened in background, never played | Lightweight page/poster, saved progress metadata, no attached media source or automatic video requests. |
| Visible and playing | One player, isolated control updates, modest preload, no unrelated background work. |
| Hidden and paused | Save position/settings, stop timers and pending nonessential requests; after a short grace period detach/reset the player. |
| Hidden and intentionally playing audio / PiP | Continue according to the chosen setting; do not destroy a player merely because the page is hidden. |
| Reactivated after suspension | Reattach source, restore position/speed/volume/captions, resume only according to the prior state and browser playback rules. |

For ordinary native `<video>`, preload is a hint, not an exact seconds-of-buffer cap ([MDN preload documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload)). A source detach/reset is a practical mechanism for aborting media loading; [MDN documents the reset behavior of `load()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/load). Measure memory reclamation rather than promising that a browser returns every byte immediately.

Exact removal of buffered time ranges requires a Media Source Extensions pipeline or an equivalent player-controlled buffer. [SourceBuffer.remove](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/remove) exposes range removal; this adds packaging, browser compatibility, and lifecycle complexity. Start with native playback plus suspension and add segmented playback only if measurements justify it. Retaining only two or three seconds ahead can make stalls more likely, especially on Wi-Fi or at 2× speed.

Use local checkpoints plus occasional acknowledged server saves, including pause/seek/end/visibility transitions. Reconcile multiple tabs so an old tab's stale update does not overwrite newer progress. Avoid silent failures and redirect-driven progress writes. Do not load comments in every dormant tab, run global polling, preload every linked watch page, or allocate video previews to every card. Let users choose whether starting another tab pauses the first.

Acceptance: open 50 watch tabs on an actual older machine; only intended playback consumes sustained media bandwidth/decoder CPU; idle tabs stop application timers/requests; progress survives suspension and browser tab discard; memory and responsiveness remain within an agreed budget. Browser process overhead cannot be eliminated by application code.

## Other confirmed defects worth fixing during the rebuild

| Defect | Consequence / proposed correction |
| --- | --- |
| Re-index deletes videos/comments before import; comment refresh deletes all sources | Local comments disappear; partial failures remove records. Use incremental upserts and source-aware reconciliation. Preserve user activity. |
| Imported counts and local likes/views share fields | Re-index overwrites local changes; comparisons and recommendations become unreliable. Separate source and local statistics. |
| Opening watch increments views, even for comment-only page reloads | Browsing comments inflates views. Count qualified playback instead of page loads. |
| Progress writes return a redirect back to the watch page | Fetch follows the redirect, potentially rerunning watch work and incrementing views. Return a small JSON/204 response and handle failures. |
| No completion save; progress only every five seconds | Resume can lag or miss the ending. Save transitions and persist a local fallback. |
| Admin watch time sums seek positions | The statistic does not measure time actually watched. Aggregate genuine playback intervals. |
| Public streaming, image, subtitle, and autocomplete routes bypass private-mode page gating | Private mode does not consistently protect library access. Apply the access policy to data/media while retaining efficient serving. |
| No application foreign keys; user deletion leaves related records; channel removal misses comment likes | Orphan data can accumulate. Introduce explicit referential constraints and deletion semantics. |
| Reply validation checks only that a parent exists | A reply can attach to a comment on another video. Validate parent video and allowed depth. |
| Admin role toggling can remove the last administrator | Preserve at least one administrator and make first-run setup explicit. |
| `allow_registration` exists but is ignored; no explicit auth throttling | Registration policy is misleading. Implement configuration and rate limits. |
| Theme values saved to the server are not included in shared preferences | Cross-device appearance restoration is incomplete. Define which preferences sync and restore them consistently. |
| Player timers/seek undo are not fully reset/cleaned up | Chapter undo and switching videos need consistent state; a hold-space timer can outlive its intended interaction. Centralize seek handling and clean up timers on blur/unmount. |
| Keyboard focus outlines are globally removed | Keyboard users cannot reliably see focus. Restore restrained, visible focus styling. |
| Search uses substring LIKE scans and manual escaping without an explicit SQL escape clause | Scale and literal wildcard searches need attention. Prefer a proper full-text index and tested literal-query behavior. |
| Optimistic mutations often ignore status/errors | Likes/settings/comments can appear saved when they failed. Use acknowledgements, rollback/retry, and compact inline error feedback. |

Tests currently consist of the framework's default home-page assertion and a trivial unit assertion. There are no meaningful tests of streaming, login longevity, rescanning, player interactions, progress, or recommendations.

## Additional suggestions, ordered by value

| Priority | Suggestion | Benefit |
| --- | --- | --- |
| Core | Continue Watching section plus Mark Watched / Reset Progress | Makes the resume experience intentional. |
| Core | Recommendation feedback, repeat cooldowns, and More Variety setting | Directly addresses the recommendation complaint. |
| Core | Library health and scan progress | Shows missing drives, unreadable files, unsupported codecs, skipped files, and import errors. |
| High | Watch Later and a lightweight queue | Supports your existing habit of opening many tabs; tabs remain supported. |
| High | Picture-in-picture and optional background audio | Useful on older machines without retaining a full visible watch interface. |
| High | Search filters: channel, duration, watched/unwatched, date added/published | Finds content without relying on the recommendation feed. |
| High | Timestamp bookmarks and copy-link-at-current-time | Complements seek undo and resuming long videos. |
| High | Export/restore settings, library mappings, progress, subscriptions | Supports moving the installation to another device. |
| Later | Playlists/collections, transcript/chapter search | Useful once the core player/library behavior is stable. |
| Later | Optional local semantic matching | Consider only if measured recommendation quality improves enough to justify it. |

## Design and stack direction for discussion

Your proposed React + TypeScript + Next.js stack is suitable. shadcn/ui can provide selected interactive components; Lucide React supplies icons. Keep React code lightweight: mount one comment tree, isolate frequent player control updates, avoid large shared state providers and unnecessary effects, and load secondary interfaces only when needed. Component-library choice alone does not establish a performance improvement; measure the resulting browser workload. The old project already uses React and lazy page imports, so the largest gains need more than changing the frontend dependencies.

Use Next.js Server Components for predominantly static page content and small Client Components for the player, search, and controls. This follows [Next.js guidance on reducing browser JavaScript](https://nextjs.org/docs/app/getting-started/server-and-client-components#reducing-js-bundle-size). A small SQLite database, background scanner, and file-serving layer are a plausible starting deployment; database/queue/deployment choices still depend on the host and workload.

Suggested visual direction: a calm, original Streamvault identity; neutral light/dark surfaces; restrained accent color; consistent typography and spacing; readable thumbnails; compact navigation; less pill-shaped clutter; a focused watch page with secondary details below the player. Avoid expensive blur, animated backgrounds, and automatic video previews. Offer comfortable and compact grid density. The old Brutalist theme is an existing feature, but whether to carry it forward is a design decision.

Review decisions before implementation:

1. Which existing features and shortcuts must remain, and whether Brutalist styling matters.
2. Whether to retain accounts/history/subscriptions/likes from the old database or start fresh. The database is inside the old project: preserve it before deletion if migration is desired; this report contains schema/behavior, not a backup of personal data.
3. Hosting device OS, CPU, RAM, storage/mount layout, LAN versus remote access, and whether containers are preferred.
4. Main client browsers/hardware, typical video codecs/resolutions, and approximate library growth.
5. Whether to add arbitrary-folder support later; yt-dlp indexing and preservation of user state during re-index are already confirmed core requirements.
6. Hidden-tab audio/PiP behavior, autoplay policy, and whether one playing tab should pause others.
7. Login duration (suggested 180-day rolling sessions), account registration policy, and private access scope.
8. Preferred feed mix/design density and which optional suggestions belong in the first release.

## Review scope and evidence

Inspected models, migrations and actual SQLite schema, all controllers/routes, import/recommendation/search services, frontend page/component behavior, configuration, package manifests, and test files. SQLite inspection was read-only. Relevant database query plans were examined. PHP, Node, and npm are not available on this machine's current PATH, so the old app was not started and runtime playback/authentication were not reproduced. No development environment was installed and no old application code was changed.

Source map from this review (for audit only; the requirements above do not depend on retaining these files):

- `app/Models/` and `database/migrations/`: schema and relationships.
- `routes/web.php`: page/action/media access policies and route inventory.
- `app/Http/Controllers/Auth/LoginController.php:35`, `resources/js/Pages/Auth/Login.tsx:15`, `config/session.php:35`: ordinary versus persistent login.
- `app/Services/RecommendationService.php:24`: recommendation inputs/scoring.
- `app/Http/Controllers/StreamController.php:11`: media delivery/range handling.
- `app/Http/Controllers/VideoController.php:52`: initial watch payload and view increment.
- `resources/js/Pages/Watch.tsx:314` and `:361`: duplicated comment trees.
- `resources/js/Components/VideoPlayer/VideoPlayer.tsx:110`: shortcuts, seek undo, saving and media lifecycle.
- `app/Services/Indexing/` and `app/Http/Controllers/Admin/ChannelAdminController.php:58`: import contract and destructive re-index.
- `app/Http/Controllers/HistoryController.php:107`: history merge/save behavior.

Existing endpoint inventory:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/login`, `/register` | Authentication pages/actions. |
| POST | `/logout` | End current login. |
| GET | `/`, `/watch?v=…`, `/channel/{channelId}`, `/search?q=…`, `/history`, `/subscriptions` | Main pages; conditionally login-protected. |
| GET | `/stream/{videoId}`, `/thumbnail/{videoId}`, `/profile-image/{channelId}`, `/banner-image/{channelId}`, `/subtitle/{videoId}/{language}` | Media delivery; unprotected in old app. |
| GET | `/api/search/autocomplete?q=…` | Suggestions; unprotected in old app. |
| POST | `/history`, `/subscribe/{channelId}`, `/like/{videoId}`, `/settings`, `/comments/{videoId}`, `/like/comment/{commentId}` | Logged-in progress, preference, and engagement mutations. |
| GET/POST | `/profile` | Account settings. |
| POST | `/profile/password` | Password change. |
| GET | `/admin`, `/admin/channels`, `/admin/users`, `/admin/settings` | Administrator pages. |
| POST | `/admin/channels` | Add/index folder. |
| PUT/DELETE | `/admin/channels/{channelId}` | Re-index/remove channel. |
| DELETE | `/admin/users/{userId}` | Delete user. |
| POST | `/admin/users/{userId}/promote`, `/admin/users/{userId}/reset-password`, `/admin/settings` | Admin role/password/settings actions. |
| GET | `/up` | Framework health endpoint. |
