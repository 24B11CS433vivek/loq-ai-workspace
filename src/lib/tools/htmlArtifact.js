// Phase 13A -- Inline Artifact Renderer: detection.
//
// Scans an assistant message's raw markdown content for fenced code
// blocks that amount to a standalone HTML/CSS/JS deliverable (a login
// page, a landing page, a small game, etc.) and, if found, returns a
// single self-contained HTML document ready to drop into an
// <iframe srcDoc>, plus a title for the card header.
//
// Deliberately text-only (regex over the raw markdown string) so this
// runs safely on every render without touching the DOM or requiring the
// message to have finished streaming -- a fenced block that hasn't been
// closed yet simply won't match, so partial code blocks never trigger it.

const FENCE_RE = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/g;

const HTML_LANGS = new Set(["html", "htm", "xhtml"]);
const CSS_LANGS = new Set(["css"]);
const JS_LANGS = new Set(["js", "javascript"]);

function extractBlocks(content) {
  const blocks = [];
  let match;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(content)) !== null) {
    const lang = (match[1] || "").trim().toLowerCase();
    const code = match[2];
    blocks.push({ lang, code });
  }
  return blocks;
}

function looksLikeMarkup(code) {
  return /<\s*[a-zA-Z][^>]*>/.test(code);
}

function extractTitle(html, content, blockIndexInContent) {
  const titleMatch = html.match(/<title>([^<]{1,80})<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) return titleMatch[1].trim();

  // Fall back to the nearest markdown heading before the code block.
  const before = content.slice(0, blockIndexInContent);
  const headingMatches = [...before.matchAll(/^#{1,4}\s+(.+)$/gm)];
  if (headingMatches.length > 0) {
    return headingMatches[headingMatches.length - 1][1].trim();
  }

  return "Web page";
}

function buildDocument(htmlBlock, cssBlocks, jsBlocks) {
  let doc = htmlBlock;
  const hasDocShell = /<html[\s>]/i.test(doc);

  const css = cssBlocks.map((b) => b.code).join("\n\n");
  const js = jsBlocks.map((b) => b.code).join("\n\n");

  if (!hasDocShell) {
    doc = [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      "</head>",
      "<body>",
      doc,
      "</body>",
      "</html>",
    ].join("\n");
  }

  // Only inject separate CSS/JS blocks if the doc doesn't already embed
  // its own <style>/<script> -- avoids double-including styles/scripts
  // the model already placed inline in the html block itself.
  if (css && !/<style[\s>]/i.test(doc)) {
    doc = /<\/head>/i.test(doc)
      ? doc.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`)
      : doc.replace(/<html[^>]*>/i, (m) => `${m}\n<head><style>\n${css}\n</style></head>`);
  }
  if (js && !/<script[\s>]/i.test(doc)) {
    doc = /<\/body>/i.test(doc)
      ? doc.replace(/<\/body>/i, `<script>\n${js}\n</script>\n</body>`)
      : doc + `\n<script>\n${js}\n</script>`;
  }

  return doc;
}

/**
 * Returns { title, html } for the most recent standalone HTML deliverable
 * in `content`, or null if there isn't one worth rendering as an artifact.
 */
export function detectHtmlArtifact(content) {
  if (!content || content.indexOf("```") === -1) return null;

  const blocks = extractBlocks(content);
  if (blocks.length === 0) return null;

  const htmlCandidates = blocks.filter(
    (b) => HTML_LANGS.has(b.lang) || (!b.lang && looksLikeMarkup(b.code))
  );
  if (htmlCandidates.length === 0) return null;

  // "Most recent wins" -- same convention used elsewhere in this app
  // (buildDocContext, findLatestDataAttachment) for picking among
  // multiple candidates in one message.
  const primary = htmlCandidates[htmlCandidates.length - 1];
  if (primary.code.trim().length < 20) return null;

  const cssBlocks = blocks.filter((b) => CSS_LANGS.has(b.lang));
  const jsBlocks = blocks.filter((b) => JS_LANGS.has(b.lang));

  const html = buildDocument(primary.code, cssBlocks, jsBlocks);
  const blockIndex = content.indexOf(primary.code);
  const title = extractTitle(html, content, blockIndex === -1 ? 0 : blockIndex);

  return { title, html };
}
