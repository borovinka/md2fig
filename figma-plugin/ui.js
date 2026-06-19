// UI side: forward raw Markdown to the main thread, which does the parsing
// and renders Figma nodes.

(function () {
  const $ = (id) => document.getElementById(id);

  $("render").addEventListener("click", () => {
    const markdown = $("md").value || "";
    parent.postMessage({ pluginMessage: { type: "render-md", markdown } }, "*");
  });

  $("sample").addEventListener("click", () => {
    $("md").value = [
      "# Sample Title",
      "",
      "A paragraph with **bold**, *italic*,",
      "[link](https://example.com) and `code`.",
      "",
      "---",
      "",
      "> Blockquote here.",
      "",
      "## List",
      "- First item",
      "- Second item",
      "",
      "## Table",
      "| Name | Value |",
      "| --- | --- |",
      "| A | 1 |",
      "| B | 2 |",
      "",
    ].join("\n");
  });
})();
