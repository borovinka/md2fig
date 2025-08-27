// UI side: parse Markdown to a structured doc model and post to main

// Minimal markdown parsing sufficient for headings, paragraphs, lists, code, tables, hr, blockquote, and inline marks
function parseMarkdown(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (!line.trim()) { i++; continue; }
    // HR
    if (/^\s*-{3,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
    // Heading
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const level = ("H" + h[1].length).toUpperCase();
      const { text, spans } = parseInline(h[2]);
      blocks.push({ type: "heading", level, text, spans }); i++; continue;
    }
    // Blockquote
    if (/^>\s?/.test(line)) {
      const content = line.replace(/^>\s?/, "");
      const { text, spans } = parseInline(content);
      blocks.push({ type: "blockquote", text, spans }); i++; continue;
    }
    // Fenced code
    if (/^```/.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume closing fence
      blocks.push({ type: "codeblock", text: buf.join("\n") });
      continue;
    }
    // Table (simple pipe table)
    if (/^\|.*\|$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        const cells = lines[i].slice(1, -1).split("|").map(s => s.trim());
        rows.push(cells);
        i++;
      }
      // Convert rows to cell objects with inline parsing, ignore alignment row like |---|
      const normalized = rows.filter(r => !r.every(c => /^:?-{3,}:?$/.test(c)) ).map(r => r.map(c => {
        const { text, spans } = parseInline(c);
        return { text, spans };
      }));
      if (normalized.length) blocks.push({ type: "table", rows: normalized });
      continue;
    }
    // List (ordered or unordered)
    const listMatch = /^\s*([*+-]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const items = [];
      let ordered = /\d+\./.test(listMatch[1]);
      while (i < lines.length) {
        const m = /^\s*([*+-]|\d+\.)\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        if (!ordered && /\d+\./.test(m[1])) ordered = true;
        const { text, spans } = parseInline(m[2]);
        items.push({ text, spans });
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    // Paragraph (collect until blank)
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim()) { buf.push(lines[i]); i++; }
    const para = buf.join(" ");
    const { text, spans } = parseInline(para);
    blocks.push({ type: "paragraph", text, spans });
  }
  // Title is first H1 if present
  const titleBlock = blocks.find(b => b.type === 'heading' && b.level === 'H1');
  return { title: titleBlock ? titleBlock.text : 'Markdown', blocks };
}

// Inline parsing: bold **text**, italic *text*, code `code`, links [text](url)
function parseInline(s) {
  const spans = [];
  let text = "";
  let i = 0;
  while (i < s.length) {
    // Link
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      const paren = end >= 0 ? s.indexOf('(', end + 1) : -1;
      const close = paren >= 0 ? s.indexOf(')', paren + 1) : -1;
      if (end > i && paren === end + 1 && close > paren) {
        const label = s.slice(i + 1, end);
        const url = s.slice(paren + 1, close);
        const start = text.length;
        text += label;
        const endPos = text.length;
        spans.push({ start, end: endPos, style: { fill: { type:'SOLID', color:{ r:0, g:0.294, b:0.980 } }, hyperlink: { type: 'URL', value: url }, fontStyle: 'Regular', fontFamily: 'Roboto' } });
        i = close + 1;
        continue;
      }
    }
    // Bold
    if (s[i] === '*' && s[i+1] === '*') {
      const close = s.indexOf('**', i + 2);
      if (close > i) {
        const content = s.slice(i + 2, close);
        const start = text.length;
        text += content;
        const endPos = text.length;
        spans.push({ start, end: endPos, style: { fontStyle: 'Bold', fontFamily: 'Roboto' } });
        i = close + 2;
        continue;
      }
    }
    // Italic
    if (s[i] === '*') {
      const close = s.indexOf('*', i + 1);
      if (close > i) {
        const content = s.slice(i + 1, close);
        const start = text.length;
        text += content;
        const endPos = text.length;
        spans.push({ start, end: endPos, style: { fontStyle: 'Italic', fontFamily: 'Roboto' } });
        i = close + 1;
        continue;
      }
    }
    // Inline code
    if (s[i] === '`') {
      const close = s.indexOf('`', i + 1);
      if (close > i) {
        const content = s.slice(i + 1, close);
        const start = text.length;
        text += content;
        const endPos = text.length;
        spans.push({ start, end: endPos, style: { code: true, fontFamily: 'Roboto Mono' } });
        i = close + 1;
        continue;
      }
    }
    text += s[i];
    i++;
  }
  return { text, spans };
}

document.getElementById('render').addEventListener('click', () => {
  const md = document.getElementById('md').value || '';
  const doc = parseMarkdown(md);
  console.log('md2fig: sending doc to plugin', doc);
  parent.postMessage({ pluginMessage: { type: 'render-md', doc } }, '*');
});

document.getElementById('sample').addEventListener('click', () => {
  document.getElementById('md').value = `# Sample Title\n\nA paragraph with **bold**, *italic*, \n[link](https://example.com) and \`code\`.\n\n---\n\n> Blockquote here.\n\n## List\n- First item\n- Second item\n\n## Table\n| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n\n\n\n\n\n\n\n\n\n\n\n`;
});


