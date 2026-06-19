# md2fig

A Figma plugin that converts GitHub‑flavored Markdown into a structured Figma frame — headings, paragraphs, lists, tables, code blocks, callouts and inline formatting are all turned into native auto‑layout text and frames.

Paste Markdown into the plugin UI, hit **Render**, and a `md2fig` frame is added to the current page.

## Install / run

1. In Figma, **Plugins → Development → Import plugin from manifest…**
2. Select [`figma-plugin/manifest.json`](figma-plugin/manifest.json).
3. Run **Markdown to Figma** from the Plugins menu.

The plugin has no network access; it operates entirely on the markdown text you paste in.

## Supported syntax

The parser targets [GitHub Basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). Click **Load sample** in the UI for a comprehensive test document.

### Block elements
- Headings `#` … `######` (and Setext `===` / `---` underlines)
- Paragraphs with hard line breaks (`  `, `\\`, `<br>`)
- Block quotes (multi‑line, lazy continuation)
- **Alerts** — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` styled with GitHub's color palette
- Fenced code blocks ` ``` ` and `~~~`
- Unordered, ordered, and **nested** lists (`-`, `*`, `+`, `1.`, `1)`)
- **Task lists** `- [ ]` / `- [x]` rendered with ☐ / ☑
- Tables — header row, **column alignment** (`:---:`), escaped pipes (`\|`), inline formatting in cells
- Horizontal rules `---`, `***`, `___`
- **Footnotes** `[^id]` — collected into a footnotes section at the bottom of the frame

### Inline elements
- **Bold** (`**` and `__`) and *italic* (`*` and `_`) with word‑boundary checks for underscore variants
- ***Bold italic*** combos (`***x***`, `___x___`, `**_x_**`, `__*x*__`)
- ~~Strikethrough~~ (`~~x~~` and `~x~`)
- `Inline code` with multi‑backtick fences (`` ``code with ` inside`` ``)
- Inline links `[text](url)` with paren‑balanced URL parsing (URLs containing `)` work)
- **Reference‑style links** `[text][id]`, `[text][]`, shortcut `[id]`
- Bare URL autolinks (`https://…`, `www.…`) and `<url>` / `<email>` autolinks
- **Images** `![alt](url)` — placeholder span with the URL preserved as a hyperlink (no network fetch)
- `<sub>`, `<sup>`, `<ins>` (underline), `<br>`, `<!-- HTML comments -->`
- **Emoji shortcodes** `:smile:` (curated set of ~50 common GitHub codes)
- **Backslash escapes** for all Markdown punctuation (`\*`, `\_`, `\|`, `\[`, …)

### Not yet supported
- Real raster image embedding (would require network access to fetch bytes)
- `<picture>` element / theme‑aware images
- Color model swatches (` `#0969DA` ` etc.)
- `@mentions`, `#issue` references, custom autolink references — these need a base repo URL to resolve
- Section anchor links (`[…](#heading)` is rendered as a link but no anchor target is generated)

## Architecture

- [`figma-plugin/manifest.json`](figma-plugin/manifest.json) — plugin metadata; `documentAccess: dynamic-page`, no network access.
- [`figma-plugin/ui.html`](figma-plugin/ui.html) — the plugin UI (FX UI Kit / SAP Horizon styling). The sample markdown lives in a hidden `<script type="text/markdown">` data block and is read via `textContent` so backticks, backslashes, and quotes don't need JS escaping.
- [`figma-plugin/main.js`](figma-plugin/main.js) — parser + renderer. Splits into:
  - `preprocess()` — extracts reference link and footnote definitions
  - `parseInline()` — emits `{ text, spans }` with style ranges for emphasis, code, links, images, autolinks, footnotes, emoji, sub/sup/ins, escapes
  - `parseMarkdown()` — block parser (headings, lists, tables, blockquotes, alerts, code, paragraphs, HR)
  - `renderDoc()` — turns the block list into Figma nodes with auto‑layout

## Changelog

### Spec‑coverage pass

**Added**
- Image syntax `![alt](url)` — placeholder + clickable hyperlink
- Task lists (`- [ ]` / `- [x]`) with ☐ / ☑ glyphs
- Strikethrough (`~~x~~` and `~x~`)
- Alert callouts (`> [!NOTE]` etc.) with GitHub‑palette borders + tints
- Underscore emphasis (`_italic_`, `__bold__`) and bold‑italic combos (`***x***`, `___x___`, `**_x_**`, `__*x*__`)
- Backslash escapes for Markdown punctuation
- Bare URL autolinks (`https://…`, `www.…`) and `<url>` / `<email>` autolinks
- Reference‑style links and footnotes (with a generated footnotes section)
- Emoji shortcodes (`:smile:`)
- Nested lists (by indent) and multi‑line blockquotes with lazy continuation
- Setext headings (`===` / `---` underlines)
- Tilde‑fenced code blocks (`~~~`)
- HTML inline tags `<sub>`, `<sup>`, `<ins>`, `<br>`, `<!-- comment -->`
- Comprehensive **Load sample** markdown that exercises every supported feature

**Fixed**
- Link URL parsing is now paren‑balanced — URLs containing `)` (e.g. Wikipedia links) no longer truncate
- Multi‑backtick inline code now works (`` ``code with ` inside`` ``)
- Tables accept rows without a trailing `|`, parse column alignment (`:---:`), and honour escaped pipes (`\|`)
- Horizontal rule matches `---`, `***`, and `___` (was `---` only)
- Blockquote left bar bumped from 1 px → 4 px to read as a proper quote bar
- Paragraph hard line breaks (trailing `  ` or `\`) now produce real `\n` instead of a literal space
