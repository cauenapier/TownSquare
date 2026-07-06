# Appearance & Colors: Two Ways to Customize

When you set colors for your TownSquare (sky, ground, buttons, etc.), you have two options for how those colors reach your visitors' browsers:

## Option 1: Automatic (Recommended) ✨

**Use the standard embed snippet. Your colors update automatically.**

### How it works:

1. Go to **Admin → Appearance** and customize your colors
2. Click **Publish**
3. Copy the **embed snippet** from the "Embed snippet" section
4. Paste it into your website's HTML (one time only)
5. Done! Your colors are live.

### When you change colors later:

1. Go to **Admin → Appearance** and change your colors
2. Click **Publish**
3. That's it! No re-pasting needed.

The standard embed snippet includes a live link to your colors. When you publish changes, they appear on your website within 5 minutes—your visitors will see them automatically.

### Pros:
- ✅ Simple: paste once, done
- ✅ Always up-to-date: changes go live automatically
- ✅ No maintenance: you never need to re-paste anything

### Cons:
- ⚠️ Updates take up to 5 minutes to appear (browser cache)
- ⚠️ Your website must reach the TownSquare server to load colors (requires internet connection)

---

## Option 2: Custom CSS (Advanced)

**For full control: paste CSS in your own stylesheet instead.**

### When to use this:

- You want colors to update instantly (no 5-minute cache)
- You want to customize colors beyond what TownSquare offers
- You want to coordinate TownSquare colors with your website's design system
- You want total control over the styling (and don't mind manual updates)

### How it works:

1. Go to **Admin → Appearance** and customize your colors
2. Click **Publish**
3. Copy the CSS from the **"Custom CSS override"** section
4. Paste it into your website's `<style>` tag or your own stylesheet
5. Done! Your custom colors are live.

### When you change colors later:

1. Go to **Admin → Appearance** and change your colors
2. Click **Publish**
3. Copy the **new** CSS from the "Custom CSS override" section
4. Update your website's CSS with the new code
5. Your changes go live immediately

### Pros:
- ✅ Complete control: customize any color in your own CSS
- ✅ Instant updates: changes appear immediately (no 5-minute cache)
- ✅ Works offline: colors are baked into your HTML (no external fetch)

### Cons:
- ⚠️ Manual updates: you must re-copy CSS each time you change colors
- ⚠️ More work: requires basic understanding of CSS and HTML

---

## Comparison Table

| | Automatic | Custom CSS |
|---|-----------|-----------|
| **Setup** | Paste once | Paste & update |
| **Update speed** | ~5 minutes | Instant |
| **Maintenance** | Zero | Manual re-pasting |
| **Control** | Basic (colors only) | Full (colors + styling) |
| **Offline support** | No | Yes |
| **Recommended for** | Most sites | Power users |

---

## Example: Using Both

You can use the **automatic** embed snippet (recommended) AND add **custom CSS** to override specific colors:

```html
<!-- This loads automatically from the server -->
<link rel="stylesheet" href="https://townsquare.your-site.com/api/sites/site_XXX/style.css" />

<!-- This is your custom CSS, which overrides the above -->
<style>
  #townsquare-root#townsquare-root {
    --scene: #my-custom-blue !important;
  }
</style>
```

In this case, your sky color uses `#my-custom-blue`, and all other colors come from TownSquare automatically.

---

## Choosing Your Path

**Ask yourself:**

- 💭 "Do I want to change colors rarely, and don't mind a 5-minute delay?"
  → **Use Automatic** ✨

- 💭 "Do I want instant updates and don't mind manually re-pasting CSS?"
  → **Use Custom CSS**

- 💭 "Do I want automatic updates most of the time, but need to customize one color?"
  → **Use Both** (automatic as base, custom CSS to override one value)

---

## FAQ

### How often should I update custom CSS?
Only when you change colors in TownSquare. If you never change colors, you never need to touch the CSS again.

### Will my visitors see the colors before they load?
With **automatic** CSS: colors load as the page loads (no delay for initial visitors).  
With **custom CSS**: colors are instant (no external load needed).

### What's that "5 minute" thing?
Browsers cache CSS files for performance. After you publish color changes, it takes up to 5 minutes for your visitors' browsers to fetch the new version. This is normal and keeps things fast.

You can reduce this if you have a CDN or caching layer, or contact TownSquare support.

### Can I use both methods at the same time?
Yes! Use automatic as your base, and add custom CSS to override specific colors. The custom CSS takes priority.

### What if I forget to re-paste custom CSS?
Your colors will be out of sync. That's why we recommend **automatic** for most users.

### Is automatic CSS less secure?
No, it's just a CSS file (like any other stylesheet). The colors are from your own site configuration, not from user input.
