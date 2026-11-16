# Styling the counter and reactions embeds

The presence counter (`/townsquare-counter.mjs`) and the reactions bar
(`/townsquare-reactions.mjs`) bring a small built-in stylesheet, so they look
right with no CSS. Everything in that stylesheet can be changed from the host
page's own CSS. Their JavaScript options (what to count, which reactions, and
so on) are documented next to each `mount…` function in the source.

## How overriding works

- **Any selector you write wins.** Every built-in rule is wrapped in
  `:where(…)`, which has zero specificity. A plain `.ts-counter { … }` in your
  stylesheet overrides it, whether your CSS loads before or after the embed.
  You never need `!important` or a more specific selector.
- **Variables work at any level.** Set a `--ts-counter-*` or `--ts-reactions-*`
  variable on the element itself, on a parent, or on `:root` to theme every
  counter or bar on the site. The embed never declares these variables itself,
  so your value is always the one used.
- **Properties work too.** Variables are the shortcut. You can also set any
  CSS property directly on the classes below (`font-family`, `letter-spacing`,
  `text-transform`, and so on).
- **The `accent` option** is written inline as the accent variable, so it wins
  over CSS. Leave it out of the snippet if you want to set the accent in CSS.
- **Hidden stays hidden.** An unknown or disabled site hides the embed with
  the `hidden` attribute. That one rule keeps normal specificity, so a
  `display` you set on the class doesn't make a hidden embed reappear.

Names prefixed `--_ts-` are private plumbing and may change. Only the names in
the tables below are a stable contract.

## Presence counter

### Markup

```html
<button class="ts-counter ts-counter--pill" data-interactive="true" data-empty="false">
  <span class="ts-counter__dot"></span>
  <span class="ts-counter__label">5 people here</span>
</button>
```

The root is a `<button>` when clicking can take the visitor to the square, and
a `<span>` otherwise.

| Selector | What it is |
| --- | --- |
| `.ts-counter` | The badge. |
| `.ts-counter--pill`, `--minimal`, `--solid`, `--outline` | The built-in look picked by the `variant` option. |
| `.ts-counter__dot` | The status dot. |
| `.ts-counter__label` | The text. |
| `[data-interactive="true"]` | Clicking scrolls to the square or opens `townSquareUrl`. |
| `[data-empty="true"]` | The count it shows is zero. The dot is dimmed by default. |
| `[title]` | Set with the full sentence when `labelStyle: "short"`. |

### Variables

| Variable | Controls |
| --- | --- |
| `--ts-counter-accent` | Dot, solid fill, outline border, and focus ring. |
| `--ts-counter-bg` | Background. Set by `pill` and `solid`. |
| `--ts-counter-ink` | Text color. Set by `solid`. |
| `--ts-counter-border-color` | Border color. Set by `outline`. |
| `--ts-counter-border-width` | Border width. |
| `--ts-counter-shadow` | Box shadow. Set by `pill`. |
| `--ts-counter-radius` | Corner radius. |
| `--ts-counter-font-size` | Text size. Padding, gap and dot scale with it. |
| `--ts-counter-pad-y`, `--ts-counter-pad-x` | Vertical and horizontal padding. Set by `minimal`. |
| `--ts-counter-gap` | Space between the dot and the text. |
| `--ts-counter-dot-color` | Dot color. Defaults to the accent; `solid` uses the text color. |
| `--ts-counter-dot-size` | Dot diameter. |
| `--ts-counter-focus-color` | Keyboard focus ring. Defaults to the accent. |

A variable you set wins over the variant's value. To change one variant only,
set it on that variant's class, e.g. `.ts-counter--solid { --ts-counter-bg: … }`.

## Reactions bar

### Markup

```html
<div class="ts-reactions" role="group" aria-label="Reactions">
  <button class="ts-reactions__button" data-reaction="heart" aria-pressed="true">
    <span class="ts-reactions__emoji">❤️</span>
    <span class="ts-reactions__count">13</span>
  </button>
  …
</div>
```

| Selector | What it is |
| --- | --- |
| `.ts-reactions` | The row of buttons. |
| `.ts-reactions__button` | One reaction. |
| `.ts-reactions__emoji` | The emoji. |
| `.ts-reactions__count` | The number. |
| `[data-reaction="heart"]` | Which reaction a button is, for per-reaction styling. Keys: `heart`, `thumbs-up`, `clap`, `laugh`, `wow`, `fire`. |
| `[aria-pressed="true"]` | This visitor has reacted. |

### Variables

| Variable | Controls |
| --- | --- |
| `--ts-reactions-accent` | Pressed border, pressed tint, and focus ring. |
| `--ts-reactions-bg` | Button background. |
| `--ts-reactions-ink` | Button text color. |
| `--ts-reactions-border-color` | Border color when not pressed. |
| `--ts-reactions-border-width` | Border width. |
| `--ts-reactions-shadow` | Button box shadow. |
| `--ts-reactions-radius` | Button corner radius. |
| `--ts-reactions-font-size` | Text size. Padding and gaps scale with it. |
| `--ts-reactions-pad-y`, `--ts-reactions-pad-x` | Button padding. The bottom gets slightly more and the emoji side slightly less, so the content looks centered. |
| `--ts-reactions-gap` | Space between buttons. |
| `--ts-reactions-button-gap` | Space between the emoji and the count. |
| `--ts-reactions-emoji-size` | Emoji size, relative to the text. |
| `--ts-reactions-pressed-bg` | Pressed background. Defaults to an accent tint of the background. |
| `--ts-reactions-pressed-border-color` | Pressed border. Defaults to the accent. |
| `--ts-reactions-pressed-ink` | Pressed text color. |
| `--ts-reactions-focus-color` | Keyboard focus ring. Defaults to the accent. |

Inside each button, the emoji and the count are trimmed to their cap height
and baseline (`text-box: trim-both cap alphabetic`), so the button centers the
visible glyphs. Browsers without `text-box` get a close fallback. If you
replace the padding with your own `padding` rule, keep the trim in mind: the
button's height comes from the padding plus the cap height.

## Recipes

Match your brand everywhere:

```css
:root {
  --ts-counter-accent: #7c3aed;
  --ts-reactions-accent: #7c3aed;
}
```

A square, bold counter without the dot:

```css
.ts-counter {
  --ts-counter-radius: 4px;
  font-weight: 600;
}
.ts-counter__dot { display: none; }
```

Larger emoji and roomier buttons:

```css
.ts-reactions {
  --ts-reactions-emoji-size: 1.4em;
  --ts-reactions-pad-y: 0.5em;
  --ts-reactions-pad-x: 0.9em;
}
```

A red heart when it's pressed:

```css
.ts-reactions__button[data-reaction="heart"][aria-pressed="true"] {
  --ts-reactions-pressed-bg: #ffe4e6;
  --ts-reactions-pressed-border-color: #e11d48;
}
```

Hide the counts and show only the emoji:

```css
.ts-reactions__count { display: none; }
```

Follow your own dark mode class:

```css
.dark .ts-counter,
.dark .ts-reactions {
  --ts-counter-ink: #f5f5f4;
  --ts-reactions-ink: #f5f5f4;
  --ts-reactions-bg: #292524;
}
```
