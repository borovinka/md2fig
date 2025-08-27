// Main plugin code: receives parsed markdown structure from UI and renders Figma nodes

// UI provided by manifest (ui.html)
figma.showUI({ width: 480, height: 560 });

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
    try { node.fontName = { family, style }; } catch (e) {}
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

// Base font-size is 16px; heading sizes reflect CSS ems: 1.66, 1.5, 1.33, 1.16, 1.0, 0.83
const HEADING_SIZES = { H1: 26.56, H2: 24, H3: 21.28, H4: 18.56, H5: 16, H6: 13.28 };

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
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Regular", fontSize: 16, fills: [TOKENS.panelText] };
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
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Italic", fontSize: 16, fills: [TOKENS.panelText] };
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
      const textNode = await createFormattedText(block.text, [{ start: 0, end: block.text.length, style: { fontFamily: "Roboto Mono" } }], { fontFamily: "Roboto Mono", fontStyle: "Regular", fontSize: 16, fills: [TOKENS.formattedText] });
      frame.appendChild(textNode);
      rootFrame.appendChild(frame);
    } else if (block.type === "list") {
      // Render list using text list properties instead of separate bullet frames
      const lines = block.items.map(it => it.text);
      const combined = lines.join("\n");
      const spans = [];
      let offset = 0;
      for (const it of block.items) {
        if (Array.isArray(it.spans)) {
          for (const sp of it.spans) {
            spans.push({ start: offset + sp.start, end: offset + sp.end, style: sp.style });
          }
        }
        offset += it.text.length + 1; // include newline
      }
      const baseStyle = { fontFamily: "Roboto", fontStyle: "Regular", fontSize: 16, fills: [TOKENS.panelText] };
      const node = await createFormattedText(combined, spans, baseStyle);
      try {
        if (typeof node.setRangeListOptions === "function") {
          node.setRangeListOptions(0, combined.length, { type: block.ordered ? "ORDERED" : "UNORDERED" });
        }
      } catch (e) {
        // If list options unsupported, leave as plain lines
      }
      rootFrame.appendChild(node);
    } else if (block.type === "table") {
      // Grid-like table using Auto Layout: rows (HORIZONTAL), cells grow equally
      const columnCount = block.rows[0] ? block.rows[0].length : 0;
      const tableFrame = figma.createFrame();
      setAutoLayout(tableFrame, { mode: "VERTICAL", spacing: 0, alignItems: "MIN" });
      tableFrame.fills = [TOKENS.codeBg];
      tableFrame.strokes = [TOKENS.border];
      tableFrame.strokeWeight = 1;
      const tableWidth = 720; // fixed table width for equal column sizing

      for (let r = 0; r < block.rows.length; r++) {
        const row = figma.createFrame();
        setAutoLayout(row, { mode: "HORIZONTAL", spacing: 0, alignItems: "MIN" });
        row.layoutSizingHorizontal = "FIXED";
        row.resize(tableWidth, row.height);

        for (let c = 0; c < block.rows[r].length; c++) {
          const cell = figma.createFrame();
          setAutoLayout(cell, { mode: "VERTICAL", spacing: 0, padding: 12, alignItems: "MIN" });
          cell.layoutGrow = 1; // make cells distribute evenly across row
          cell.strokes = [TOKENS.border];
          cell.strokeWeight = 1;
          cell.fills = r === 0 ? [TOKENS.tableHeaderBg] : [];
          const baseStyle = { fontFamily: "Roboto", fontStyle: r === 0 ? "Medium" : "Regular", fontSize: 16, fills: [TOKENS.formattedText] };
          const textNode = await createFormattedText(block.rows[r][c].text, block.rows[r][c].spans, baseStyle);
          textNode.textAutoResize = "WIDTH_AND_HEIGHT";
          cell.appendChild(textNode);
          row.appendChild(cell);
        }
        tableFrame.appendChild(row);
      }
      tableFrame.layoutSizingHorizontal = "FIXED";
      tableFrame.resize(tableWidth, tableFrame.height);
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


