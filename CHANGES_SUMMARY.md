# Two-Path CSS Strategy: Changes Summary

## Overview

This implementation provides site owners with two clear options for delivering appearance colors (sky, ground, etc.) to TownSquare widgets:

1. **Automatic (Server-Served CSS)** — Recommended for most sites
2. **Manual (Custom CSS Override)** — For advanced users who want full control

## Changes Made

### 1. Server Backend (`server.js`)

#### A. New Dynamic CSS Endpoint (Lines 1356-1377)

**What:** Added `handleSiteStyleCss()` function that generates and serves site-specific CSS dynamically.

**Why:** Allows appearance changes to be live without requiring manual CSS re-pasting.

**Technical details:**
- Endpoint: `GET /api/sites/{siteKey}/style.css`
- Response: CSS with palette tokens (`--scene`, `--ground-fill`, etc.)
- Cache: 5 minutes (public, max-age=300)
- Fallback: Returns 404 if site doesn't exist or is disabled

#### B. Route Handler (Lines 3015-3018)

**What:** Added route matching for the new CSS endpoint.

**Pattern:** `/^\/api\/sites\/[^/]+\/style\.css$/`

**Processing:** Extracts `siteKey` from URL pathname and calls handler.

#### C. Updated Embed Snippet (Lines 811-814)

**What:** Modified `buildEmbedSnippet()` to include the CSS link in the standard embed snippet.

**Change:** Added this line to the snippet:
```html
<link rel="stylesheet" href="${serverOrigin}/api/sites/${site.siteKey}/style.css" />
```

**Why:** Makes the CSS automatic by default; users get live updates without extra work.

### 2. Admin UI (`public/admin/hosted/admin.html`)

#### A. Updated Introduction Text (Line 204)

**Before:**
> "Colors are delivered as CSS — re-copy the Customization CSS below after publishing color changes."

**After:**
> "Your colors are delivered automatically — see the Embed snippet section for details."

**Why:** Frames the automatic approach as the default, reducing confusion.

#### B. Redesigned Embed Snippet Section (Lines 323-335)

**Changes:**
- Added `<strong>Recommended:</strong>` label
- Emphasized that everything updates automatically
- Clarified that "no re-pasting needed"
- Added explicit statement: "Your appearance changes are live the moment you hit Publish"
- Updated power-user note to reference custom CSS option

**Goal:** Make it clear that the standard snippet is the recommended path.

#### C. Redesigned Custom CSS Section (Lines 386-399)

**Changes:**
- Renamed from "Customization CSS" to "Custom CSS override (optional)"
- Added `<strong>For advanced customization only.</strong>` label
- Rewrote description to clarify this is for users who want custom control
- Added "When to use this:" section explaining use cases
- Emphasized that custom CSS requires manual updates

**Goal:** Make it clear this is an optional advanced feature, not the primary method.

### 3. Documentation Files (New)

#### A. `IMPLEMENTATION_NOTES.md`

**Purpose:** Technical documentation for developers and maintainers.

**Contents:**
- Architecture overview
- How the endpoint works
- CSS specificity strategy
- Cache behavior and rationale
- File changes summary
- Testing instructions
- Future improvements
- Backward compatibility notes

#### B. `docs/APPEARANCE_CSS_GUIDE.md`

**Purpose:** User-facing guide for site owners.

**Contents:**
- Clear explanation of both options
- Step-by-step workflows for each approach
- Pros and cons comparison
- When to use each option
- FAQ section
- Example of using both approaches together

## How Site Owners Now Interact With This

### User Path 1: Automatic (Default)

```
User sets sky color to blue
    ↓
Clicks "Publish"
    ↓
Copies standard embed snippet (includes CSS link)
    ↓
Pastes into website
    ↓
Colors appear live
    ↓
[Changes color to red tomorrow]
    ↓
Clicks "Publish"
    ↓
No re-pasting! CSS endpoint automatically serves red
    ↓
Visitor's browser shows red (within 5 min cache window)
```

### User Path 2: Custom CSS

```
User sets sky color to blue
    ↓
Clicks "Publish"
    ↓
Copies embed snippet + custom CSS
    ↓
Pastes both into website
    ↓
Colors appear live (with custom CSS taking priority)
    ↓
[Changes color to red tomorrow]
    ↓
Clicks "Publish"
    ↓
Copies NEW custom CSS
    ↓
Updates website CSS with new values
    ↓
Colors update immediately
```

## Backward Compatibility

✅ **Fully backward compatible.** Sites that have already pasted the old embed snippet (without the CSS link) continue to work normally. They can upgrade anytime by re-pasting the new snippet.

## Testing Verification

All components tested and verified:

```bash
✓ Dynamic CSS endpoint returns valid CSS
✓ CSS includes correct palette tokens
✓ Endpoint handles missing/disabled sites (404)
✓ Cache headers are set correctly
✓ Embed snippet includes CSS link
✓ Admin UI displays both options clearly
✓ No breaking changes to existing functionality
```

## Performance Impact

- **Server:** Minimal (endpoint just calls existing `buildSiteCss()` function)
- **Client:** Same bandwidth as before (CSS is CSS, whether static or dynamic)
- **Cache:** 5-minute public cache reduces redundant server calls

## Future Enhancements

1. Make cache duration configurable per site
2. Add ETags for intelligent cache validation
3. Webhook notifications on appearance changes
4. Admin dashboard to view CSS without copying
5. CSS preview tool before publishing

## Summary

This implementation gives site owners a clear, simple default path (automatic CSS) while preserving the option for advanced customization. The documentation makes both options obvious, reducing confusion about whether colors need to be manually updated.

**Key achievement:** Site owners can now set colors once, publish, and have them update automatically across their website without ever re-pasting anything. This is the simpler, recommended path for the vast majority of users.
