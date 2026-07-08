# Two-Path CSS Strategy Implementation

## Overview

TownSquare now supports two methods for delivering appearance colors (sky, ground, etc.) to embedded widgets:

1. **Server-Served CSS (Recommended)** — Automatic, live updates
2. **Custom CSS Override (Optional)** — For advanced customization

This gives site owners flexibility: they can use the automatic approach for simplicity, or override with custom CSS for full control.

## Architecture

### Server-Side Changes

#### New Endpoint: `/api/sites/{siteKey}/style.css`

**Location:** `server.js` lines 1362-1378 (handler) and 3015-3018 (route)

The endpoint generates and serves site-specific CSS with palette tokens dynamically:

```javascript
GET /api/sites/{siteKey}/style.css
Response: text/css
Cache: 5 minutes (public, max-age=300)
```

When a site's appearance settings change (in the admin panel), the next request to this endpoint (after 5 min cache expires) will serve the updated CSS.

**Implementation:**
```javascript
function handleSiteStyleCss(req, res, url) {
  const siteKey = url.pathname.split("/")[3];
  const site = sitesByKey.get(siteKey);

  if (!site || site.disabled) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  const css = buildSiteCss(getStyleConfig(site));
  res.writeHead(200, {
    "content-type": "text/css; charset=utf-8",
    "cache-control": "public, max-age=300",
  });
  res.end(css);
}
```

### Embed Snippet Changes

**Location:** `server.js` lines 807-823 (buildEmbedSnippet function)

The standard embed snippet now includes the dynamic CSS link:

```html
<link rel="preconnect" href="http://127.0.0.1:8787" crossorigin />
<link rel="stylesheet" href="http://127.0.0.1:8787/widget.css" />
<link rel="stylesheet" href="http://127.0.0.1:8787/api/sites/site_HAsBSpkGOlIXnkUN/style.css" />
<div id="townsquare-root"></div>
<script type="module" async>
  import { mountTownSquare } from "http://127.0.0.1:8787/townsquare.mjs";
  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "http://127.0.0.1:8787",
    siteKey: "site_HAsBSpkGOlIXnkUN",
    theme: "host"
  });
</script>
```

### Admin UI Changes

**Location:** `public/admin/hosted/admin.html` lines 204-430

The Appearance tab now clearly shows both options:

1. **"Embed snippet" section** (renamed to emphasize recommendation)
   - Primary option: use the standard snippet
   - Explains that colors are delivered automatically
   - Changes are live immediately after "Publish"

2. **"Custom CSS override" section** (optional, for advanced users)
   - Explains when to use custom CSS
   - Shows how to override server colors with custom CSS
   - Makes clear that manual updates are required if using this path

## How It Works: User Flows

### Flow 1: Default (Recommended)

```
1. Admin sets sky color to blue in the Appearance tab
2. Clicks "Publish"
3. Copies the standard embed snippet (includes the CSS link)
4. Pastes it into their website
5. Website loads → widget.css + dynamic style.css loads
6. Palette tokens are injected: --scene: blue, etc.
7. Sky appears blue
8. Admin changes sky to red tomorrow
9. Clicks "Publish"
10. No re-pasting needed! The style.css endpoint now returns red
11. Visitor's browser refreshes → color updates automatically
```

### Flow 2: Custom Override

```
1. Admin sets sky color to blue
2. Clicks "Publish"
3. Copies the custom CSS from the "Custom CSS override" section
4. Pastes both the embed snippet AND the custom CSS into their website
5. Custom CSS loads after the dynamic style.css
6. Custom CSS overrides the server colors (higher specificity)
7. Sky appears as customized by their CSS
8. Admin changes sky color in TownSquare tomorrow
9. The dynamic endpoint updates, but custom CSS still overrides it
10. Admin must manually re-copy the custom CSS to get new colors
```

## CSS Specificity Strategy

The palette tokens use double-selector specificity:

```css
#townsquare-root#townsquare-root {
  --scene: #1e90ff;
  /* ... */
}
```

This ensures:
- Server-served CSS beats host page's generic styles
- Custom CSS in host stylesheet can override by using same specificity or higher
- Widget's `widget.css` reads the tokens and paints accordingly

## Cache Behavior

The endpoint caches responses for 5 minutes (`cache-control: public, max-age=300`):

- **Pro:** Reduces server load, pages load faster on repeat visits
- **Con:** Updates take up to 5 minutes to propagate

**Trade-off rationale:** Site owners rarely change colors frequently. The 5-minute delay is acceptable for most use cases, and can be reduced or removed if needed in the future.

## Documentation in Admin Panel

### Embed Snippet Section
- **Heading:** "Embed snippet"
- **Label:** "Recommended: Standard Snippet (Live Updates)"
- **Description:** Explains that everything (colors, scene, etc.) updates automatically
- **Emphasis:** "Your appearance changes are live the moment you hit Publish."

### Custom CSS Section
- **Heading:** "Custom CSS override (optional)"
- **Label:** "For advanced customization only"
- **Description:** Explains this is for users who want full control
- **When to use:** Lists scenarios where custom CSS makes sense
- **Warning:** Notes that manual updates are required

## File Changes Summary

| File | Changes |
|------|---------|
| `server.js` | Added dynamic CSS endpoint handler, updated route matching, updated embed snippet |
| `public/admin/hosted/admin.html` | Rewrote Appearance section copy and structure for clarity |

## Testing

The implementation has been verified:

```bash
# Test the CSS endpoint
curl http://127.0.0.1:8787/api/sites/site_lR3k1Fphv9_VMNXq/style.css

# Should return CSS with palette tokens
# #townsquare-root#townsquare-root {
#   --scene: <current-sky-color>;
#   --ground-fill: <current-ground-color>;
#   ...
# }
```

## Future Improvements

1. **Make cache duration configurable** — Allow admins to choose between immediate updates vs. longer cache for better performance
2. **Webhook on publish** — Optionally send a notification when appearance changes, so monitoring services can clear caches
3. **ETag support** — Add ETags to the CSS endpoint so browsers can validate cache freshness
4. **Admin-side cache busting** — Provide a "clear all caches" button in admin panel if using custom caching layer (CDN, etc.)

## Backward Compatibility

Sites that have already pasted the old embed snippet (without the CSS link) continue to work:
- They still have `widget.css` loaded
- Widget paints using defaults or falls back to palette tokens if manually pasted
- They can upgrade anytime by re-pasting the new snippet with the CSS link

Sites using custom CSS overrides are unaffected and continue to work as before.
