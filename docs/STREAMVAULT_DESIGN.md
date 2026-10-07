# Streamvault design decisions

Design review, 7 October 2026. This records requirements independently of the old application.

- Neutral Gallery layout, with matching light and dark modes. Icon-only sun/moon switch at the far right of the header, with an accessible label.
- The featured resume section appears occasionally, rather than on every home visit. When displayed, show one featured resume video and exactly three additional videos beside it. Hide the entire section if there are not enough eligible unfinished videos to fill it. Avoid nearly finished, stale, or duplicate resume suggestions; exact thresholds remain to be decided.
- Ordinary home visits can go directly to the recommendation grid. The explicit Continue watching filter remains available whenever users want it.
- Recommendations populate a vertical grid. Scrolling loads additional rows, never a horizontal video carousel. Use cursor pagination, lazy thumbnails, and bounded rendering of distant rows to keep long sessions light. Preserve the mix and scroll position when returning from a watch page. Stop cleanly at the end of the library.
- Tighten spacing between video titles and metadata. Do not reserve a blank second title line for cards with short titles.
- Mobile uses a compact two-row header, a hamburger menu with labeled navigation destinations, wrapping filters, and a single-column thumbnail feed on phones. The watch page stacks the player, details, comments, and recommendations. Keep touch targets and editable text usable.

The interactive previews use a finite sample video list and simulate additional rows locally. They do not implement streaming, recommendation ranking, indexing, authentication, or measured resource limits. The eventual application must satisfy the performance and preservation requirements in STREAMVAULT_ANALYSIS.md.
