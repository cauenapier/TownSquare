# Widget loading benchmark

The stable `/townsquare.mjs` URL now serves a minified bundle of the core widget
modules. `/widget.css` now includes the rules from `tokens.css` in the response.
Both URLs and the embed snippet remain the same, so installed embeds receive the
change when their cached assets refresh. The original source modules and
`/tokens.css` remain available, including for older cached stylesheets.

## Cold load measurement

`node scripts/widget-load-benchmark.mjs` registers a hosted site on an isolated
local server, places its real generated snippet on a synthetic host page, and
measures five fresh Chromium contexts at 390 × 844. It adds 80 ms of latency to
each widget asset request. Run `BASELINE=1 node scripts/widget-load-benchmark.mjs`
to serve the original module and stylesheet bytes at the same URLs for comparison.
Values below are medians in milliseconds except request counts.

| Widget position | Assets | DOM ready | Page load | Widget mounted | Widget requests | JS requests | CSS requests |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Above fold | Original | 176 | 479 | 467 | 34 | 31 | 3 |
| Above fold | Optimized | 92 | 200 | 188 | 3 | 1 | 2 |
| Below fold | Original | 177 | 481 | 469 | 34 | 31 | 3 |
| Below fold | Optimized | 90 | 198 | 186 | 3 | 1 | 2 |

For the static widget assets, Brotli bytes fell from 73,742 to 27,450 for JS
and from 18,798 to 18,546 for CSS. The host page's simple LCP element remained
at 16 ms and CLS remained zero in both cases. This benchmark measures cold local
loads under added request latency; it is not a field measurement of an installed
site or a bandwidth/CPU-throttled PageSpeed score.

The bundle is built from the source modules on first request and rebuilt after
source edits. If bundling fails, the server serves the original module graph.
The Plus widget modules continue to load dynamically. Viewport-delaying the
whole embed was considered but would change live presence and visitor counts
for people who do not scroll to the widget. Loading the hosted snippet's CSS
through JavaScript was also left out: it would only reach newly pasted snippets
and would delay the widget's WebSocket join until the CSS load finished.
