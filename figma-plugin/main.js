// Main plugin code: receives parsed markdown structure from UI and renders Figma nodes

// Inline UI HTML string to satisfy showUI(htmlString, options)
const UI_HTML = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Markdown to Figma</title><style>:root{--panel-background:#EBEBEB;--panel-text:#333333;--formatted-text:#000000;--link:#004BFA;--border:#777777;--code:rgba(255,255,255,.8);--table:var(--code);--table-header:rgba(128,128,128,.2);}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Ubuntu,'Droid Sans',sans-serif;font-size:12px;background:var(--panel-background);color:var(--panel-text);margin:0;}#app{padding:12px;}textarea{width:100%;height:280px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:#fff}.actions{margin-top:8px;display:flex;gap:8px}button{font-size:12px;padding:6px 10px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer}button.primary{background:#000;color:#fff;border-color:#000}</style></head><body><div id="app"><p>Paste Markdown below. Click Render to create a styled frame.</p><textarea id="md" placeholder="# Title\n\nSome text with **bold**, *italic*, [link](https://example.com)."></textarea><div class="actions"><button id="render" class="primary">Render</button><button id="sample">Load sample</button></div></div><script>(${function(){
function parseMarkdown(md){const lines=md.replace(/\r\n?/g,"\n").split("\n");const blocks=[];let i=0;while(i<lines.length){let line=lines[i];if(!line.trim()){i++;continue}if(/^\s*-{3,}\s*$/.test(line)){blocks.push({type:"hr"});i++;continue}const h=/^(#{1,6})\s+(.+)$/.exec(line);if(h){const level=("H"+h[1].length).toUpperCase();const {text,spans}=parseInline(h[2]);blocks.push({type:"heading",level,text,spans});i++;continue}if(/^>\s?/.test(line)){const content=line.replace(/^>\s?/,"");const {text,spans}=parseInline(content);blocks.push({type:"blockquote",text,spans});i++;continue}if(/^```/.test(line)){i++;const buf=[];while(i<lines.length&&!/^```/.test(lines[i])){buf.push(lines[i]);i++}i++;blocks.push({type:"codeblock",text:buf.join("\n")});continue}if(/^\|.*\|$/.test(line)){const rows=[];while(i<lines.length&&/^\|.*\|$/.test(lines[i])){const cells=lines[i].slice(1,-1).split("|").map(s=>s.trim());rows.push(cells);i++}const normalized=rows.filter(r=>!r.every(c=>/^:?-{3,}:?$/.test(c))).map(r=>r.map(c=>{const {text,spans}=parseInline(c);return {text,spans}}));if(normalized.length)blocks.push({type:"table",rows:normalized});continue}const listMatch=/^\s*([*+-]|\d+\.)\s+(.+)$/.exec(line);if(listMatch){const items=[];while(i<lines.length){const m=/^\s*([*+-]|\d+\.)\s+(.+)$/.exec(lines[i]);if(!m)break;const marker=/\d+\./.test(m[1])?m[1]:"•";const {text,spans}=parseInline(m[2]);items.push({marker,text,spans});i++}blocks.push({type:"list",items});continue}const buf=[line];i++;while(i<lines.length&&lines[i].trim()){buf.push(lines[i]);i++}const para=buf.join(" ");const {text,spans}=parseInline(para);blocks.push({type:"paragraph",text,spans})}const titleBlock=blocks.find(b=>b.type==='heading'&&b.level==='H1');return {title:titleBlock?titleBlock.text:'Markdown',blocks}};
function parseInline(s){const spans=[];let text="";let i=0;while(i<s.length){if(s[i]==='['){const end=s.indexOf(']',i+1);const paren=end>=0?s.indexOf('(',end+1):-1;const close=paren>=0?s.indexOf(')',paren+1):-1;if(end>i&&paren===end+1&&close>paren){const label=s.slice(i+1,end);const url=s.slice(paren+1,close);const start=text.length;text+=label;const endPos=text.length;spans.push({start,end:endPos,style:{fill:{type:'SOLID',color:{r:0,g:0.294,b:0.980}},hyperlink:{type:'URL',value:url},fontStyle:'Regular',fontFamily:'Roboto',fontSize:12}});i=close+1;continue}}if(s[i]==='*'&&s[i+1]==='*'){const close=s.indexOf('**',i+2);if(close>i){const content=s.slice(i+2,close);const start=text.length;text+=content;const endPos=text.length;spans.push({start,end:endPos,style:{fontStyle:'Bold',fontFamily:'Roboto'}});i=close+2;continue}}if(s[i]==='*'){const close=s.indexOf('*',i+1);if(close>i){const content=s.slice(i+1,close);const start=text.length;text+=content;const endPos=text.length;spans.push({start,end:endPos,style:{fontStyle:'Italic',fontFamily:'Roboto'}});i=close+1;continue}}if(s[i]==='`'){const close=s.indexOf('`',i+1);if(close>i){const content=s.slice(i+1,close);const start=text.length;text+=content;const endPos=text.length;spans.push({start,end:endPos,style:{code:true,fontFamily:'Roboto Mono'}});i=close+1;continue}}text+=s[i];i++}return {text,spans}};
document.getElementById('render').addEventListener('click',()=>{const md=document.getElementById('md').value||'';const doc=parseMarkdown(md);console.log('md2fig: sending doc to plugin',doc);parent.postMessage({pluginMessage:{type:'render-md',doc}},'*')});
document.getElementById('sample').addEventListener('click',()=>{document.getElementById('md').value="# Sample Title\n\nA paragraph with **bold**, *italic*, \n[link](https://example.com) and `code`.\n\n---\n\n> Blockquote here.\n\n## List\n- First item\n- Second item\n\n## Table\n| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n"});}.toString()})()</script></body></html>`;

figma.showUI(UI_HTML, { width: 480, height: 560 });

// Utility: create text node with inline formatting spans
async function createFormattedText(text, spans, baseStyle) {
  const node = figma.createText();
  // Ensure the current font (default Inter Regular) is loaded before setting characters
  await figma.loadFontAsync({ family: "Inter", style: "Regular" }).catch(() => {});
  node.characters = text || "";
  // Apply base font if specified
  if (baseStyle.fontFamily || baseStyle.fontStyle) {
    const family = baseStyle.fontFamily || "Inter";
    const style = baseStyle.fontStyle || "Regular";
    await figma.loadFontAsync({ family, style }).catch(() => {});
    try { node.fontName = { family, style }; } catch {}
  }
  // Apply base styling
  if (baseStyle.fontSize) node.fontSize = baseStyle.fontSize;
  if (baseStyle.fills) node.fills = baseStyle.fills;
  if (baseStyle.hyperlink) node.hyperlink = baseStyle.hyperlink;
  // Inline spans: [{start,end,style:{bold,italic,code,linkUrl}}]
  if (Array.isArray(spans)) {
    for (const span of spans) {
      const start = Math.max(0, Math.min(node.characters.length, span.start || 0));
      const end = Math.max(start, Math.min(node.characters.length, span.end || 0));
      if (start >= end) continue;
      try {
        if (span.style && (span.style.bold || span.style.italic || span.style.fontFamily || span.style.fontStyle || span.style.fontSize)) {
          const family = span.style.fontFamily || baseStyle.fontFamily || "Roboto";
          const style = span.style.fontStyle || (span.style.bold && span.style.italic ? "Bold Italic" : span.style.bold ? "Bold" : span.style.italic ? "Italic" : baseStyle.fontStyle || "Regular");
          await figma.loadFontAsync({ family, style }).catch(() => {});
          node.setRangeFontName(start, end, { family, style });
          if (span.style.fontSize) node.setRangeFontSize(start, end, span.style.fontSize);
        }
        if (span.style && span.style.fill) {
          node.setRangeFills(start, end, [span.style.fill]);
        }
        if (span.style && typeof span.style.hyperlink === "object") {
          node.setRangeHyperlink(start, end, span.style.hyperlink);
        }
        if (span.style && span.style.code) {
          const family = span.style.fontFamily || "Roboto Mono";
          await figma.loadFontAsync({ family, style: "Regular" }).catch(() => {});
          node.setRangeFontName(start, end, { family, style: "Regular" });
          if (span.style.codeBackground) {
            // For inline code, emulate background by wrapping in a rectangle behind in layout; handled by caller when needed
          }
        }
      } catch (e) {
        // Ignore font errors for unavailable styles
      }
    }
  }
  return node;
}

function colorFromHex(hex, opacity = 1) {
  // hex like #RRGGBB
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity };
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  return { type: "SOLID", color: { r, g, b }, opacity };
}

// Map style tokens (mirrors style.css)
const TOKENS = {
  formattedText: colorFromHex("#000000"),
  link: colorFromHex("#004BFA"),
  border: colorFromHex("#777777"),
  codeBg: { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.8 },
  tableHeaderBg: { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.2 },
  panelText: colorFromHex("#333333"),
};

const HEADING_SIZES = { H1: 20, H2: 18, H3: 16, H4: 14, H5: 12, H6: 10 };

function setAutoLayout(container, opts) {
  container.layoutMode = opts.mode || "VERTICAL";
  container.primaryAxisSizingMode = "AUTO";
  container.counterAxisSizingMode = "AUTO";
  container.counterAxisAlignItems = opts.alignItems || "MIN";
  container.itemSpacing = opts.spacing != null ? opts.spacing : 8;
  container.paddingTop = opts.padding != null ? opts.padding : 0;
  container.paddingRight = opts.padding != null ? opts.padding : 0;
  container.paddingBottom = opts.padding != null ? opts.padding : 0;
  container.paddingLeft = opts.padding != null ? opts.padding : 0;
}

async function renderDoc(doc) {
  const rootFrame = figma.createFrame();
  rootFrame.name = doc.title || "Markdown";
  setAutoLayout(rootFrame, { mode: "VERTICAL", spacing: 8, padding: 24, alignItems: "MIN" });
  rootFrame.fills = [colorFromHex("#EBEBEB")];

  for (const block of doc.blocks) {
    if (block.type === "heading") {
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Bold", fontSize: HEADING_SIZES[block.level] || 12, fills: [TOKENS.formattedText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      rootFrame.appendChild(node);
    } else if (block.type === "paragraph") {
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Regular", fontSize: 12, fills: [TOKENS.panelText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      node.textAutoResize = "WIDTH_AND_HEIGHT";
      rootFrame.appendChild(node);
    } else if (block.type === "blockquote") {
      const quote = figma.createFrame();
      setAutoLayout(quote, { mode: "VERTICAL", spacing: 4, padding: 8, alignItems: "MIN" });
      quote.strokes = [TOKENS.border];
      quote.strokeLeftWeight = 1;
      quote.strokeTopWeight = 0;
      quote.strokeRightWeight = 0;
      quote.strokeBottomWeight = 0;
      quote.layoutSizingHorizontal = "HUG";
      quote.layoutSizingVertical = "HUG";
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Italic", fontSize: 12, fills: [TOKENS.panelText] };
      const node = await createFormattedText(block.text, block.spans, baseStyle);
      quote.appendChild(node);
      rootFrame.appendChild(quote);
    } else if (block.type === "hr") {
      const line = figma.createRectangle();
      line.resize(600, 1);
      line.fills = [];
      line.strokes = [TOKENS.border];
      rootFrame.appendChild(line);
    } else if (block.type === "codeblock") {
      const frame = figma.createFrame();
      setAutoLayout(frame, { mode: "VERTICAL", spacing: 4, padding: 16, alignItems: "MIN" });
      frame.fills = [TOKENS.codeBg];
      frame.strokes = [TOKENS.border];
      frame.cornerRadius = 6;
      const textNode = await createFormattedText(block.text, [{ start: 0, end: block.text.length, style: { fontFamily: "Roboto Mono" } }], { fontFamily: "Roboto Mono", fontStyle: "Regular", fontSize: 12, fills: [TOKENS.formattedText] });
      frame.appendChild(textNode);
      rootFrame.appendChild(frame);
    } else if (block.type === "list") {
      const listFrame = figma.createFrame();
      setAutoLayout(listFrame, { mode: "VERTICAL", spacing: 4, alignItems: "MIN" });
      for (const item of block.items) {
        const row = figma.createFrame();
        setAutoLayout(row, { mode: "HORIZONTAL", spacing: 8, alignItems: "MIN" });
        const bullet = await createFormattedText(item.marker, [], { fontFamily: "Roboto", fontStyle: "Regular", fontSize: 12, fills: [TOKENS.panelText] });
        const text = await createFormattedText(item.text, item.spans, { fontFamily: "Roboto", fontStyle: "Regular", fontSize: 12, fills: [TOKENS.panelText] });
        row.appendChild(bullet);
        row.appendChild(text);
        listFrame.appendChild(row);
      }
      rootFrame.appendChild(listFrame);
    } else if (block.type === "table") {
      // Create grid-like layout using rows and cells
      const tableFrame = figma.createFrame();
      setAutoLayout(tableFrame, { mode: "VERTICAL", spacing: 0, alignItems: "MIN" });
      tableFrame.strokes = [TOKENS.border];
      tableFrame.fills = [TOKENS.codeBg];
      for (let r = 0; r < block.rows.length; r++) {
        const row = figma.createFrame();
        setAutoLayout(row, { mode: "HORIZONTAL", spacing: 0, alignItems: "MIN" });
        for (let c = 0; c < block.rows[r].length; c++) {
          const cell = figma.createFrame();
          setAutoLayout(cell, { mode: "VERTICAL", spacing: 0, padding: 12, alignItems: "MIN" });
          cell.strokes = [TOKENS.border];
          cell.fills = r === 0 ? [TOKENS.tableHeaderBg] : [];
          const baseStyle = { fontFamily: "Roboto", fontStyle: r === 0 ? "Medium" : "Regular", fontSize: 12, fills: [TOKENS.formattedText] };
          const textNode = await createFormattedText(block.rows[r][c].text, block.rows[r][c].spans, baseStyle);
          cell.appendChild(textNode);
          row.appendChild(cell);
        }
        tableFrame.appendChild(row);
      }
      rootFrame.appendChild(tableFrame);
    }
  }

  rootFrame.x = figma.viewport.center.x - rootFrame.width / 2;
  rootFrame.y = figma.viewport.center.y - rootFrame.height / 2;
  figma.currentPage.appendChild(rootFrame);
  figma.viewport.scrollAndZoomIntoView([rootFrame]);
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "render-md" && msg.doc) {
      figma.notify("Rendering markdown…", { timeout: 1000 });
      await renderDoc(msg.doc);
      figma.notify("Markdown rendered", { timeout: 1200 });
    }
  } catch (e) {
    figma.notify("Error rendering markdown (see console)");
    console.error("md2fig render error", e);
  }
};


