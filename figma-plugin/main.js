// Main plugin code: receives raw markdown from UI, parses it, and renders Figma nodes.

// __html__ is replaced at load time by the contents of manifest.ui (ui.html).
figma.showUI(__html__, { width: 480, height: 560, themeColors: true });

// ===================== Emoji shortcodes =====================
// Small curated set of the most common GitHub shortcodes.
const EMOJI_MAP = {
  'smile': '😄', 'grin': '😁', 'joy': '😂', 'rofl': '🤣',
  'wink': '😉', 'heart': '❤️', '+1': '👍', 'thumbsup': '👍',
  '-1': '👎', 'thumbsdown': '👎', 'tada': '🎉', 'rocket': '🚀',
  'fire': '🔥', 'star': '⭐', 'check': '✅', 'x': '❌',
  'warning': '⚠️', 'bulb': '💡', 'eyes': '👀', 'sparkles': '✨',
  'cry': '😢', 'sob': '😭', 'angry': '😠', 'sweat_smile': '😅',
  'thinking': '🤔', '100': '💯', 'ok_hand': '👌', 'pray': '🙏',
  'clap': '👏', 'muscle': '💪', 'wave': '👋', 'point_right': '👉',
  'point_left': '👈', 'point_up': '👆', 'point_down': '👇',
  'arrow_right': '➡️', 'arrow_left': '⬅️', 'arrow_up': '⬆️',
  'arrow_down': '⬇️', 'white_check_mark': '✅', 'heavy_check_mark': '✔️',
  'question': '❓', 'exclamation': '❗', 'zap': '⚡', 'bug': '🐛',
  'lock': '🔒', 'key': '🔑', 'mag': '🔍', 'wrench': '🔧',
  'hammer': '🔨', 'gear': '⚙️', 'package': '📦', 'memo': '📝',
  'book': '📖', 'books': '📚', 'art': '🎨', 'computer': '💻',
  'see_no_evil': '🙈', 'shrug': '🤷', 'raised_hands': '🙌',
};

// Markdown special chars that backslash escapes should pass through literally.
const ESCAPABLE = "\\`*_{}[]<>()#+-.!|~^";

// ===================== Inline parsing =====================
// Walks a string and produces { text, spans } where spans carry styling for ranges
// of the produced text. Handles: escapes, code spans, strikethrough, bold/italic
// (** __ * _), bold-italic (*** ___ **_…_** etc.), links [text](url), reference
// links [text][id] / [id][], images ![alt](url), bare URLs, footnote refs [^id],
// and :emoji: shortcodes.
function parseInline(s, ctx) {
  ctx = ctx || {};
  const refs = ctx.refs || {};
  const footnotes = ctx.footnotes || {};
  const onImage = ctx.onImage || null; // optional: collect inline images
  const spans = [];
  let text = "";
  let i = 0;

  function pushSpan(start, end, style) {
    if (end > start) spans.push({ start, end, style });
  }

  // Try to match a delimiter run for emphasis (** __ * _) starting at i.
  // Returns { length, content, style } or null.
  function tryEmphasis() {
    // Order: triple (bold+italic) first, then double (bold), then single (italic).
    const tries = [
      { open: '***', close: '***', style: { bold: true, italic: true } },
      { open: '___', close: '___', style: { bold: true, italic: true } },
      { open: '**_', close: '_**', style: { bold: true, italic: true } },
      { open: '__*', close: '*__', style: { bold: true, italic: true } },
      { open: '**',  close: '**',  style: { bold: true } },
      { open: '__',  close: '__',  style: { bold: true } },
      { open: '*',   close: '*',   style: { italic: true } },
      { open: '_',   close: '_',   style: { italic: true } },
    ];
    for (const t of tries) {
      if (s.substr(i, t.open.length) !== t.open) continue;
      // Find matching close, skipping escaped chars and nested code
      let j = i + t.open.length;
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) { j += 2; continue; }
        if (s[j] === '`') {
          // Skip over inline code
          const end = s.indexOf('`', j + 1);
          if (end < 0) break;
          j = end + 1; continue;
        }
        if (s.substr(j, t.close.length) === t.close) {
          // For underscore variants, require word-boundary semantics: the char
          // before open must not be alnum, the char after close must not be alnum.
          if (t.open[0] === '_') {
            const before = s[i - 1] || ' ';
            const after = s[j + t.close.length] || ' ';
            if (/\w/.test(before) || /\w/.test(after)) return null;
          }
          // The open marker can't be followed by whitespace, and the close
          // marker can't be preceded by whitespace (CommonMark heuristic).
          if (/\s/.test(s[i + t.open.length] || '') || /\s/.test(s[j - 1] || '')) {
            // try a longer scan: don't accept this close, advance and look again
            j++; continue;
          }
          return { length: j + t.close.length - i, content: s.slice(i + t.open.length, j), style: t.style };
        }
        j++;
      }
    }
    return null;
  }

  // Find a balanced ']' for a bracket starting at i (s[i] === '[').
  function findBracketClose(start) {
    let depth = 1, j = start + 1;
    while (j < s.length) {
      if (s[j] === '\\' && j + 1 < s.length) { j += 2; continue; }
      if (s[j] === '`') {
        const end = s.indexOf('`', j + 1);
        if (end < 0) return -1;
        j = end + 1; continue;
      }
      if (s[j] === '[') depth++;
      else if (s[j] === ']') { depth--; if (depth === 0) return j; }
      j++;
    }
    return -1;
  }

  // Parse a parenthesized URL "(url 'title')" starting at pos pointing at '('.
  function parseParenUrl(pos) {
    if (s[pos] !== '(') return null;
    let j = pos + 1, depth = 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '\\' && j + 1 < s.length) { j += 2; continue; }
      if (s[j] === '(') depth++;
      else if (s[j] === ')') { depth--; if (depth === 0) break; }
      j++;
    }
    if (depth !== 0) return null;
    let inner = s.slice(pos + 1, j).trim();
    // strip optional title in quotes
    inner = inner.replace(/\s+["'][^"']*["']\s*$/, '').trim();
    return { url: inner, end: j + 1 };
  }

  // Bare URL autolink: detect http(s)://… and www.…
  const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>()\[\]"']+[^\s<>()\[\]"'.,;:!?]/;

  while (i < s.length) {
    const ch = s[i];

    // Backslash escape
    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.indexOf(s[i + 1]) >= 0) {
      text += s[i + 1];
      i += 2;
      continue;
    }

    // Inline code: `…` or ``…``
    if (ch === '`') {
      let runLen = 1;
      while (s[i + runLen] === '`') runLen++;
      const open = '`'.repeat(runLen);
      const closeIdx = s.indexOf(open, i + runLen);
      if (closeIdx > 0) {
        let content = s.slice(i + runLen, closeIdx);
        // CommonMark: if content begins+ends with a space and isn't all spaces, trim one
        if (content.length > 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim().length) {
          content = content.slice(1, -1);
        }
        const start = text.length;
        text += content;
        pushSpan(start, text.length, { code: true, fontFamily: '72 Mono' });
        i = closeIdx + runLen;
        continue;
      }
    }

    // Strikethrough ~~…~~ or ~…~
    if (ch === '~') {
      const isDouble = s[i + 1] === '~';
      const open = isDouble ? '~~' : '~';
      // For single tilde, require word-boundary semantics to avoid swallowing paths like ~/.config~/foo
      if (!isDouble) {
        const before = s[i - 1] || ' ';
        const after = s[i + 1] || ' ';
        if (/\w/.test(before) || /\s/.test(after)) {
          // fall through to literal
        } else {
          const close = s.indexOf('~', i + 1);
          if (close > i + 1 && s[close + 1] !== '~' && s[close - 1] !== '~') {
            const inner = parseInline(s.slice(i + 1, close), ctx);
            const start = text.length;
            text += inner.text;
            const baseEnd = text.length;
            for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
            pushSpan(start, baseEnd, { strikethrough: true });
            i = close + 1;
            continue;
          }
        }
      } else {
        const close = s.indexOf('~~', i + 2);
        if (close > i + 2) {
          const inner = parseInline(s.slice(i + 2, close), ctx);
          const start = text.length;
          text += inner.text;
          const baseEnd = text.length;
          for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
          pushSpan(start, baseEnd, { strikethrough: true });
          i = close + 2;
          continue;
        }
      }
    }

    // Image ![alt](url)
    if (ch === '!' && s[i + 1] === '[') {
      const closeBracket = findBracketClose(i + 1);
      if (closeBracket > 0) {
        const parens = parseParenUrl(closeBracket + 1);
        if (parens) {
          const alt = s.slice(i + 2, closeBracket);
          if (onImage) onImage({ alt, url: parens.url });
          // Inline fallback: render as "[image: alt]" with link styling
          const label = '🖼 ' + (alt || parens.url);
          const start = text.length;
          text += label;
          pushSpan(start, text.length, {
            fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
            hyperlink: { type: 'URL', value: parens.url },
            italic: true,
          });
          i = parens.end;
          continue;
        }
      }
    }

    // Footnote reference [^id]
    if (ch === '[' && s[i + 1] === '^') {
      const close = s.indexOf(']', i + 2);
      if (close > 0) {
        const id = s.slice(i + 2, close);
        if (footnotes[id] != null) {
          const num = footnotes[id].num;
          const start = text.length;
          text += '[' + num + ']';
          pushSpan(start, text.length, { superscript: true, fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } } });
          i = close + 1;
          continue;
        }
      }
    }

    // Inline link [text](url) or reference [text][id] / [text][] / [id]
    if (ch === '[') {
      const closeBracket = findBracketClose(i);
      if (closeBracket > 0) {
        const labelRaw = s.slice(i + 1, closeBracket);
        // Inline: [label](url)
        if (s[closeBracket + 1] === '(') {
          const parens = parseParenUrl(closeBracket + 1);
          if (parens) {
            const inner = parseInline(labelRaw, ctx);
            const start = text.length;
            text += inner.text;
            const labelEnd = text.length;
            for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
            pushSpan(start, labelEnd, {
              fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
              hyperlink: { type: 'URL', value: parens.url },
            });
            i = parens.end;
            continue;
          }
        }
        // Reference: [label][id] or [label][]
        if (s[closeBracket + 1] === '[') {
          const idClose = s.indexOf(']', closeBracket + 2);
          if (idClose > 0) {
            const id = (s.slice(closeBracket + 2, idClose).trim() || labelRaw).toLowerCase();
            if (refs[id]) {
              const inner = parseInline(labelRaw, ctx);
              const start = text.length;
              text += inner.text;
              const labelEnd = text.length;
              for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
              pushSpan(start, labelEnd, {
                fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
                hyperlink: { type: 'URL', value: refs[id] },
              });
              i = idClose + 1;
              continue;
            }
          }
        }
        // Shortcut reference: [label]
        const id = labelRaw.toLowerCase();
        if (refs[id]) {
          const inner = parseInline(labelRaw, ctx);
          const start = text.length;
          text += inner.text;
          const labelEnd = text.length;
          for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
          pushSpan(start, labelEnd, {
            fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
            hyperlink: { type: 'URL', value: refs[id] },
          });
          i = closeBracket + 1;
          continue;
        }
      }
    }

    // Autolink <url>
    if (ch === '<') {
      const close = s.indexOf('>', i + 1);
      if (close > 0) {
        const inner = s.slice(i + 1, close);
        if (/^https?:\/\/\S+$/.test(inner) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inner)) {
          const url = inner.indexOf('@') > 0 && !/^https?:/.test(inner) ? 'mailto:' + inner : inner;
          const start = text.length;
          text += inner;
          pushSpan(start, text.length, {
            fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
            hyperlink: { type: 'URL', value: url },
          });
          i = close + 1;
          continue;
        }
      }
    }

    // Bare URL autolink
    if ((ch === 'h' || ch === 'w') && (s[i - 1] === undefined || /[\s(\[<]/.test(s[i - 1]))) {
      const m = URL_RE.exec(s.slice(i));
      if (m) {
        const url = m[0];
        const fullUrl = url.startsWith('www.') ? 'https://' + url : url;
        const start = text.length;
        text += url;
        pushSpan(start, text.length, {
          fill: { type: 'SOLID', color: { r: 0, g: 0.294, b: 0.980 } },
          hyperlink: { type: 'URL', value: fullUrl },
        });
        i += url.length;
        continue;
      }
    }

    // Emoji :code:
    if (ch === ':') {
      const close = s.indexOf(':', i + 1);
      if (close > i + 1 && close - i < 40) {
        const code = s.slice(i + 1, close);
        if (/^[a-z0-9_+\-]+$/i.test(code) && EMOJI_MAP[code]) {
          text += EMOJI_MAP[code];
          i = close + 1;
          continue;
        }
      }
    }

    // Emphasis (bold / italic / bold-italic)
    if (ch === '*' || ch === '_') {
      const em = tryEmphasis();
      if (em) {
        const inner = parseInline(em.content, ctx);
        const start = text.length;
        text += inner.text;
        const baseEnd = text.length;
        for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
        pushSpan(start, baseEnd, em.style);
        i += em.length;
        continue;
      }
    }

    // HTML tags we map to inline styles: <sub>, <sup>, <ins>, <br>
    if (ch === '<') {
      const tagMatch = /^<(\/?)(sub|sup|ins|br|br\s*\/?)\s*\/?>/i.exec(s.slice(i));
      if (tagMatch) {
        const name = tagMatch[2].toLowerCase();
        if (name.startsWith('br')) {
          text += '\n';
          i += tagMatch[0].length;
          continue;
        }
        if (tagMatch[1]) { // closing tag — handled by paired logic below
          i += tagMatch[0].length;
          continue;
        }
        const closeRe = new RegExp('</' + name + '\\s*>', 'i');
        const rest = s.slice(i + tagMatch[0].length);
        const closeM = closeRe.exec(rest);
        if (closeM) {
          const inner = parseInline(rest.slice(0, closeM.index), ctx);
          const start = text.length;
          text += inner.text;
          const innerEnd = text.length;
          for (const sp of inner.spans) spans.push({ start: start + sp.start, end: start + sp.end, style: sp.style });
          if (name === 'sub') pushSpan(start, innerEnd, { subscript: true });
          else if (name === 'sup') pushSpan(start, innerEnd, { superscript: true });
          else if (name === 'ins') pushSpan(start, innerEnd, { underline: true });
          i += tagMatch[0].length + closeM.index + closeM[0].length;
          continue;
        }
      }
      // HTML comment <!-- ... -->
      if (s.substr(i, 4) === '<!--') {
        const end = s.indexOf('-->', i + 4);
        if (end > 0) { i = end + 3; continue; }
      }
    }

    text += ch;
    i++;
  }

  return { text, spans };
}

// ===================== Block parsing =====================

function preprocess(md) {
  // Normalize line endings; extract reference link defs and footnote defs.
  const rawLines = md.replace(/\r\n?/g, "\n").split("\n");
  const refs = {};
  const footnotes = {};
  let footCounter = 0;
  const lines = [];
  for (let k = 0; k < rawLines.length; k++) {
    const ln = rawLines[k];
    // Footnote definition: [^id]: text (may continue on indented lines, but we keep it simple)
    const fn = /^\[\^([^\]]+)\]:\s+(.*)$/.exec(ln);
    if (fn) {
      const id = fn[1];
      footCounter++;
      let body = fn[2];
      // capture indented continuation lines
      while (k + 1 < rawLines.length && /^\s{2,}\S/.test(rawLines[k + 1])) {
        body += ' ' + rawLines[k + 1].trim();
        k++;
      }
      footnotes[id] = { num: footCounter, body };
      continue;
    }
    // Reference link definition: [id]: url ["title"]
    const rf = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)(?:\s+["'(].*["')])?\s*$/.exec(ln);
    if (rf) { refs[rf[1].toLowerCase()] = rf[2]; continue; }
    lines.push(ln);
  }
  return { lines, refs, footnotes };
}

function parseMarkdown(md) {
  const pre = preprocess(md);
  const { lines, refs, footnotes } = pre;
  const ctx = { refs, footnotes };
  const blocks = [];
  let i = 0;

  // Parse a list (possibly with nested items by indent) starting at line `i`.
  function parseList() {
    const items = []; // { indent, ordered, text, spans, task, checked }
    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) {
        // a blank line ends the list unless followed by another list item with the same indent
        const next = lines[i + 1];
        if (next && /^\s*([*+\-]|\d+[.)])\s+/.test(next)) { i++; continue; }
        break;
      }
      const m = /^(\s*)([*+\-]|\d+[.)])\s+(.*)$/.exec(ln);
      if (!m) {
        // Allow a continuation line to extend the previous item's text
        if (items.length && /^\s+\S/.test(ln)) {
          items[items.length - 1].rawText += ' ' + ln.trim();
          i++;
          continue;
        }
        break;
      }
      const indent = m[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(m[2]);
      let content = m[3];
      let task = false, checked = false;
      const tm = /^\[([ xX])\]\s+(.*)$/.exec(content);
      if (tm) { task = true; checked = tm[1].toLowerCase() === 'x'; content = tm[2]; }
      items.push({ indent, ordered, rawText: content, task, checked });
      i++;
    }
    // Normalize indents to discrete levels (0, 1, 2…)
    const indents = Array.from(new Set(items.map(it => it.indent))).sort((a, b) => a - b);
    const levelMap = new Map(indents.map((v, idx) => [v, idx]));
    for (const it of items) {
      it.level = levelMap.get(it.indent);
      const parsed = parseInline(it.rawText, ctx);
      it.text = parsed.text;
      it.spans = parsed.spans;
    }
    return { type: 'list', items };
  }

  // Parse a blockquote (possibly multi-line, possibly an alert) starting at `i`.
  function parseBlockquote() {
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      buf.push(lines[i].replace(/^>\s?/, ''));
      i++;
      // allow lazy continuation: a non-blank, non-`>` line that doesn't start a new block
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^>\s?/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^\s*([*+\-]|\d+[.)])\s+/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^\|.*\|?\s*$/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
    }
    const joined = buf.join('\n');
    // Alert detection: first line is [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
    const alertM = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i.exec(joined);
    if (alertM) {
      const kind = alertM[1].toUpperCase();
      const body = alertM[2].replace(/^\n+/, '');
      const parsed = parseInline(body.replace(/\n/g, ' '), ctx);
      return { type: 'alert', kind, text: parsed.text, spans: parsed.spans };
    }
    const parsed = parseInline(joined.replace(/\n+/g, ' '), ctx);
    return { type: 'blockquote', text: parsed.text, spans: parsed.spans };
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Horizontal rule: ---, ***, or ___ (3+ same char, optional whitespace)
    if (/^[ ]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
      blocks.push({ type: 'hr' }); i++; continue;
    }

    // ATX heading
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = 'H' + h[1].length;
      const parsed = parseInline(h[2], ctx);
      blocks.push({ type: 'heading', level, text: parsed.text, spans: parsed.spans });
      i++; continue;
    }

    // Setext heading: previous paragraph followed by === or ---
    // (rare; handled if next line is === or ---)
    if (i + 1 < lines.length && /^=+\s*$/.test(lines[i + 1]) && line.trim()) {
      const parsed = parseInline(line, ctx);
      blocks.push({ type: 'heading', level: 'H1', text: parsed.text, spans: parsed.spans });
      i += 2; continue;
    }
    if (i + 1 < lines.length && /^-+\s*$/.test(lines[i + 1]) && line.trim() && !/^\s*-/.test(line)) {
      const parsed = parseInline(line, ctx);
      blocks.push({ type: 'heading', level: 'H2', text: parsed.text, spans: parsed.spans });
      i += 2; continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) { blocks.push(parseBlockquote()); continue; }

    // Fenced code block
    const fence = /^(\s*)(```|~~~)\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const fenceMark = fence[2];
      i++;
      const buf = [];
      while (i < lines.length && lines[i].trimStart().indexOf(fenceMark) !== 0) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'codeblock', lang: fence[3] || '', text: buf.join('\n') });
      continue;
    }

    // Table: at least one pipe and a separator row beneath
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|\-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      function splitRow(s) {
        let s2 = s.trim();
        if (s2.startsWith('|')) s2 = s2.slice(1);
        if (s2.endsWith('|')) s2 = s2.slice(0, -1);
        // honor escaped pipes
        const cells = [];
        let cur = '';
        for (let k = 0; k < s2.length; k++) {
          if (s2[k] === '\\' && s2[k + 1] === '|') { cur += '|'; k++; continue; }
          if (s2[k] === '|') { cells.push(cur.trim()); cur = ''; continue; }
          cur += s2[k];
        }
        cells.push(cur.trim());
        return cells;
      }
      const headerCells = splitRow(line);
      const sepCells = splitRow(lines[i + 1]);
      const aligns = sepCells.map(c => {
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        if (left && right) return 'CENTER';
        if (right) return 'RIGHT';
        return 'LEFT';
      });
      i += 2;
      const rows = [headerCells.map(c => parseInline(c, ctx))];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map(c => parseInline(c, ctx)));
        i++;
      }
      blocks.push({ type: 'table', rows, aligns });
      continue;
    }

    // List
    if (/^\s*([*+\-]|\d+[.)])\s+/.test(line)) {
      blocks.push(parseList());
      continue;
    }

    // Paragraph: keep collecting until blank / new block
    const buf = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (/^(#{1,6})\s+/.test(next)) break;
      if (/^>\s?/.test(next)) break;
      if (/^```/.test(next) || /^~~~/.test(next)) break;
      if (/^[ ]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(next)) break;
      if (/^\s*([*+\-]|\d+[.)])\s+/.test(next)) break;
      // Setext underline of next paragraph: stop, leave this paragraph intact
      buf.push(next);
      i++;
    }
    // GitHub treats a literal "<br>" or trailing "  " / "\\" as a hard line break.
    // Mark each line with a sentinel separator (\n for hard break, space otherwise).
    let joined = '';
    for (let bi = 0; bi < buf.length; bi++) {
      let ln = buf[bi];
      let sep = ' ';
      if (bi < buf.length - 1) {
        if (/  +$/.test(ln)) { ln = ln.replace(/  +$/, ''); sep = '\n'; }
        else if (/\\$/.test(ln)) { ln = ln.replace(/\\$/, ''); sep = '\n'; }
      } else {
        sep = '';
      }
      joined += ln + sep;
    }
    const parsed = parseInline(joined, ctx);
    blocks.push({ type: 'paragraph', text: parsed.text, spans: parsed.spans });
  }

  // Append a footnotes block at the end if any defined
  const fkeys = Object.keys(footnotes);
  if (fkeys.length) {
    blocks.push({ type: 'hr' });
    blocks.push({ type: 'heading', level: 'H6', text: 'Footnotes', spans: [] });
    const items = fkeys
      .sort((a, b) => footnotes[a].num - footnotes[b].num)
      .map(id => {
        const parsed = parseInline(footnotes[id].body, ctx);
        return { level: 0, ordered: true, text: parsed.text, spans: parsed.spans };
      });
    blocks.push({ type: 'list', items });
  }

  const titleBlock = blocks.find(b => b.type === 'heading' && b.level === 'H1');
  return { title: titleBlock ? titleBlock.text : 'Markdown', blocks };
}

// ===================== Figma rendering =====================

async function createFormattedText(text, spans, baseStyle) {
  const node = figma.createText();
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).catch(() => {});
  node.characters = text || '';
  if (baseStyle.fontFamily || baseStyle.fontStyle) {
    const family = baseStyle.fontFamily || 'Inter';
    const style = baseStyle.fontStyle || 'Regular';
    await figma.loadFontAsync({ family, style }).catch(() => {});
    try { node.fontName = { family, style }; } catch (e) {}
  }
  if (baseStyle.fontSize) node.fontSize = baseStyle.fontSize;
  if (baseStyle.fills) node.fills = baseStyle.fills;
  if (baseStyle.hyperlink) node.hyperlink = baseStyle.hyperlink;

  if (Array.isArray(spans)) {
    for (const span of spans) {
      const start = Math.max(0, Math.min(node.characters.length, span.start || 0));
      const end = Math.max(start, Math.min(node.characters.length, span.end || 0));
      if (start >= end) continue;
      try {
        const wantsBold = !!span.style.bold;
        const wantsItalic = !!span.style.italic;
        const isCode = !!span.style.code;
        if (wantsBold || wantsItalic || span.style.fontFamily || span.style.fontStyle || span.style.fontSize) {
          let family = span.style.fontFamily || baseStyle.fontFamily || 'Inter';
          let style = span.style.fontStyle ||
            (wantsBold && wantsItalic ? 'Bold Italic' :
             wantsBold ? 'Bold' :
             wantsItalic ? 'Italic' :
             baseStyle.fontStyle || 'Regular');
          await figma.loadFontAsync({ family, style }).catch(() => {});
          try { node.setRangeFontName(start, end, { family, style }); } catch (e) {}
          if (span.style.fontSize) node.setRangeFontSize(start, end, span.style.fontSize);
        }
        if (isCode) {
          const family = span.style.fontFamily || '72 Mono';
          await figma.loadFontAsync({ family, style: 'Regular' }).catch(() => {});
          try { node.setRangeFontName(start, end, { family, style: 'Regular' }); } catch (e) {}
        }
        if (span.style.fill) {
          node.setRangeFills(start, end, [span.style.fill]);
        }
        if (typeof span.style.hyperlink === 'object') {
          node.setRangeHyperlink(start, end, span.style.hyperlink);
        }
        if (span.style.strikethrough) {
          try { node.setRangeTextDecoration(start, end, 'STRIKETHROUGH'); } catch (e) {}
        }
        if (span.style.underline) {
          try { node.setRangeTextDecoration(start, end, 'UNDERLINE'); } catch (e) {}
        }
        if (span.style.subscript || span.style.superscript) {
          // Approximate sub/sup with a smaller font size since not all fonts have OpenType variants.
          const baseFs = baseStyle.fontSize || 16;
          try { node.setRangeFontSize(start, end, Math.round(baseFs * 0.7)); } catch (e) {}
        }
      } catch (e) {
        // Ignore font / API errors for unavailable styles
      }
    }
  }
  return node;
}

function colorFromHex(hex, opacity = 1) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity };
  return {
    type: 'SOLID',
    color: {
      r: parseInt(m[1], 16) / 255,
      g: parseInt(m[2], 16) / 255,
      b: parseInt(m[3], 16) / 255,
    },
    opacity,
  };
}

const TOKENS = {
  formattedText: colorFromHex('#000000'),
  link: colorFromHex('#004BFA'),
  border: colorFromHex('#777777'),
  codeBg: { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.8 },
  tableHeaderBg: { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.2 },
  panelText: colorFromHex('#333333'),
  imagePlaceholderBg: { type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 } },
};

// Alert color schemes (border + tint) — close to GitHub's palette.
const ALERT_STYLES = {
  NOTE:      { border: colorFromHex('#0969DA'), tint: { type: 'SOLID', color: { r: 0.04, g: 0.41, b: 0.85 }, opacity: 0.08 }, label: 'Note' },
  TIP:       { border: colorFromHex('#1A7F37'), tint: { type: 'SOLID', color: { r: 0.10, g: 0.50, b: 0.22 }, opacity: 0.08 }, label: 'Tip' },
  IMPORTANT: { border: colorFromHex('#8250DF'), tint: { type: 'SOLID', color: { r: 0.51, g: 0.31, b: 0.87 }, opacity: 0.08 }, label: 'Important' },
  WARNING:   { border: colorFromHex('#9A6700'), tint: { type: 'SOLID', color: { r: 0.60, g: 0.40, b: 0.00 }, opacity: 0.10 }, label: 'Warning' },
  CAUTION:   { border: colorFromHex('#CF222E'), tint: { type: 'SOLID', color: { r: 0.81, g: 0.13, b: 0.18 }, opacity: 0.08 }, label: 'Caution' },
};

const HEADING_SIZES = { H1: 26.56, H2: 24, H3: 21.28, H4: 18.56, H5: 16, H6: 13.28 };

function setAutoLayout(container, opts) {
  container.layoutMode = opts.mode || 'VERTICAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'AUTO';
  container.counterAxisAlignItems = opts.alignItems || 'MIN';
  container.itemSpacing = opts.spacing != null ? opts.spacing : 8;
  container.paddingTop = opts.padding != null ? opts.padding : 0;
  container.paddingRight = opts.padding != null ? opts.padding : 0;
  container.paddingBottom = opts.padding != null ? opts.padding : 0;
  container.paddingLeft = opts.padding != null ? opts.padding : 0;
}

async function renderDoc(doc) {
  const rootFrame = figma.createFrame();
  rootFrame.name = 'md2fig';
  setAutoLayout(rootFrame, { mode: 'VERTICAL', spacing: 8, padding: 24, alignItems: 'MIN' });
  rootFrame.fills = [colorFromHex('#EBEBEB')];
  rootFrame.resize(960, rootFrame.height);
  rootFrame.layoutSizingHorizontal = 'FIXED';

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const baseStyle = { fontFamily: 'Roboto', fontStyle: 'Bold', fontSize: HEADING_SIZES[block.level] || 12, fills: [TOKENS.formattedText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      rootFrame.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'paragraph') {
      const baseStyle = { fontFamily: 'Roboto', fontStyle: 'Regular', fontSize: 16, fills: [TOKENS.panelText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
      rootFrame.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'blockquote') {
      const quote = figma.createFrame();
      setAutoLayout(quote, { mode: 'VERTICAL', spacing: 4, padding: 8, alignItems: 'MIN' });
      quote.strokes = [TOKENS.border];
      quote.strokeLeftWeight = 4;
      quote.strokeTopWeight = 0;
      quote.strokeRightWeight = 0;
      quote.strokeBottomWeight = 0;
      const baseStyle = { fontFamily: 'Roboto', fontStyle: 'Italic', fontSize: 16, fills: [TOKENS.panelText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      quote.appendChild(node);
      rootFrame.appendChild(quote);
      quote.layoutSizingHorizontal = 'FILL';
      node.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'alert') {
      const style = ALERT_STYLES[block.kind] || ALERT_STYLES.NOTE;
      const alertFrame = figma.createFrame();
      setAutoLayout(alertFrame, { mode: 'VERTICAL', spacing: 6, padding: 12, alignItems: 'MIN' });
      alertFrame.fills = [style.tint];
      alertFrame.strokes = [style.border];
      alertFrame.strokeLeftWeight = 4;
      alertFrame.strokeTopWeight = 0;
      alertFrame.strokeRightWeight = 0;
      alertFrame.strokeBottomWeight = 0;
      alertFrame.cornerRadius = 4;
      const headBase = { fontFamily: 'Roboto', fontStyle: 'Bold', fontSize: 14, fills: [style.border] };
      const head = await createFormattedText(style.label, [], headBase);
      alertFrame.appendChild(head);
      const bodyBase = { fontFamily: 'Roboto', fontStyle: 'Regular', fontSize: 16, fills: [TOKENS.panelText] };
      const body = await createFormattedText(block.text, block.spans, bodyBase);
      alertFrame.appendChild(body);
      rootFrame.appendChild(alertFrame);
      alertFrame.layoutSizingHorizontal = 'FILL';
      head.layoutSizingHorizontal = 'FILL';
      body.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'hr') {
      const line = figma.createRectangle();
      line.resize(1, 1);
      line.fills = [];
      line.strokes = [TOKENS.border];
      rootFrame.appendChild(line);
      line.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'codeblock') {
      const frame = figma.createFrame();
      setAutoLayout(frame, { mode: 'VERTICAL', spacing: 4, padding: 16, alignItems: 'MIN' });
      frame.fills = [TOKENS.codeBg];
      frame.strokes = [TOKENS.border];
      frame.cornerRadius = 6;
      const codeStyle = { fontFamily: '72 Mono', fontStyle: 'Regular', fontSize: 14, fills: [TOKENS.formattedText] };
      const textNode = await createFormattedText(
        block.text,
        [{ start: 0, end: block.text.length, style: { fontFamily: '72 Mono' } }],
        codeStyle
      );
      frame.appendChild(textNode);
      rootFrame.appendChild(frame);
      frame.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'list') {
      // Task list items render with a checkbox glyph; non-task items use Figma's
      // native list options.
      const items = block.items;
      // Render as a single text node, then apply per-line indentation/list options.
      // Build the combined string with task glyphs inlined for task items.
      const lineTexts = items.map(it => it.task
        ? (it.checked ? '☑ ' : '☐ ') + it.text
        : it.text);
      const combined = lineTexts.join('\n');
      const spans = [];
      let offset = 0;
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const prefixLen = it.task ? 2 : 0;
        for (const sp of (it.spans || [])) {
          spans.push({ start: offset + prefixLen + sp.start, end: offset + prefixLen + sp.end, style: sp.style });
        }
        offset += lineTexts[idx].length + 1;
      }
      const baseStyle = { fontFamily: 'Roboto', fontStyle: 'Regular', fontSize: 16, fills: [TOKENS.panelText] };
      const node = await createFormattedText(combined, spans, baseStyle);
      try {
        if (typeof node.setRangeListOptions === 'function') {
          // Walk per-item and apply list options + indentation per line range.
          let pos = 0;
          for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            const len = lineTexts[idx].length;
            const start = pos, end = pos + len;
            if (!it.task) {
              try { node.setRangeListOptions(start, end, { type: it.ordered ? 'ORDERED' : 'UNORDERED' }); } catch (e) {}
            }
            if (it.level && typeof node.setRangeIndentation === 'function') {
              try { node.setRangeIndentation(start, end, it.level); } catch (e) {}
            }
            pos += len + 1;
          }
        }
      } catch (e) {}
      rootFrame.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
    } else if (block.type === 'table') {
      const tableFrame = figma.createFrame();
      setAutoLayout(tableFrame, { mode: 'VERTICAL', spacing: 0, alignItems: 'MIN' });
      tableFrame.fills = [TOKENS.codeBg];
      tableFrame.strokes = [TOKENS.border];
      tableFrame.strokeWeight = 1;
      const aligns = block.aligns || [];
      for (let r = 0; r < block.rows.length; r++) {
        const row = figma.createFrame();
        setAutoLayout(row, { mode: 'HORIZONTAL', spacing: 0, alignItems: 'MIN' });
        for (let c = 0; c < block.rows[r].length; c++) {
          const cell = figma.createFrame();
          setAutoLayout(cell, { mode: 'VERTICAL', spacing: 0, padding: 12, alignItems: 'MIN' });
          cell.layoutGrow = 1;
          cell.strokes = [TOKENS.border];
          cell.strokeWeight = 1;
          cell.fills = r === 0 ? [TOKENS.tableHeaderBg] : [];
          const baseStyle = { fontFamily: 'Roboto', fontStyle: r === 0 ? 'Medium' : 'Regular', fontSize: 16, fills: [TOKENS.formattedText] };
          const textNode = await createFormattedText(block.rows[r][c].text, block.rows[r][c].spans, baseStyle);
          textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
          const align = aligns[c] || 'LEFT';
          try { textNode.textAlignHorizontal = align; } catch (e) {}
          cell.appendChild(textNode);
          row.appendChild(cell);
        }
        tableFrame.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
      }
      rootFrame.appendChild(tableFrame);
      tableFrame.layoutSizingHorizontal = 'FILL';
    }
  }
  rootFrame.x = figma.viewport.center.x - rootFrame.width / 2;
  rootFrame.y = figma.viewport.center.y - rootFrame.height / 2;
  figma.currentPage.appendChild(rootFrame);
  figma.viewport.scrollAndZoomIntoView([rootFrame]);
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'render-md') {
      const doc = parseMarkdown(msg.markdown || '');
      figma.notify('Rendering markdown…', { timeout: 1000 });
      await renderDoc(doc);
      figma.notify('Markdown rendered', { timeout: 1200 });
    }
  } catch (e) {
    figma.notify('Error rendering markdown (see console)');
    console.error('md2fig render error', e);
  }
};
