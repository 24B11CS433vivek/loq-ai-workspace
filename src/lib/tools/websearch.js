const base = (url) => url.replace(/\/$/, "");

/**
 * Calls the FastAPI backend's web search endpoint.
 * Returns { query, results: [{ url, title, text }] } or throws on failure.
 */
export async function webSearch(query, backendUrl, numResults = 8) {
  if (!query || !query.trim()) {
    throw new Error("webSearch: query cannot be empty");
  }

  if (!backendUrl) {
    throw new Error("webSearch: backendUrl is required");
  }

  const res = await fetch(`${base(backendUrl)}/tools/search/web`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.trim(), num_results: numResults }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`webSearch failed (${res.status}): ${detail}`);
  }

  return res.json();
}

/**
 * Formats search results into a context block to prepend/inject into the
 * chat prompt, plus a parallel citations array for rendering in Message.jsx.
 *
 * IMPORTANT: this pulls from ALL populated categories (results, science,
 * files, social, news, shopping, video_transcripts), not just `results` --
 * a query can come back with results:0 but science:4 (e.g. "recent arxiv
 * papers on transformers"), and the model needs that data to answer
 * accurately instead of guessing. Only `results` gets numbered [1]/[2]/...
 * citations (Message.jsx's citation chips are keyed off that array/index)
 * -- the other categories are still handed to the model as real facts,
 * just attributed by source name instead of a citation number.
 */
export function buildSearchContext(searchResponse) {
  const { query, results = [], confidence, retrieved_at, instant_answer } = searchResponse;
  const retrievedNote = retrieved_at
    ? `Current date/time: ${new Date(retrieved_at).toUTCString()}. Treat this as "today" for any question involving "latest", "current", "today", or a date comparison.`
    : "";
  const science = searchResponse.science || [];
  const files = searchResponse.files || [];
  const social = searchResponse.social || [];
  const news = searchResponse.news || [];
  const videos = searchResponse.videos || [];
  const images = searchResponse.images || [];
  const shopping = searchResponse.shopping || [];
  const videoTranscripts = searchResponse.video_transcripts || [];

  const hasResults = results.length > 0;
  const hasExtras =
    science.length || files.length || social.length || news.length ||
    videos.length || images.length || shopping.length || videoTranscripts.length ||
    Boolean(instant_answer);

  // Nothing at all came back (e.g. general search engines are rate-limited
  // and no category matched either) -- tell the model explicitly instead
  // of silently sending no context and letting it invent specifics.
  if (!hasResults && !hasExtras) {
    return {
      contextBlock: [
        retrievedNote,
        `A web search was attempted for "${query}" but returned no usable results (the search backend may be temporarily unavailable, or every candidate page blocked scraping/extraction).`,
        "Do not invent specific facts, URLs, IDs, usernames, or sources to fill this gap.",
        "Tell the user plainly that live search came back empty for this query, then answer only from what you already know, clearly flagging that it may be outdated.",
      ].filter(Boolean).join("\n\n"),
      citations: [],
    };
  }

  const citations = results.map((r, i) => ({
    index: i + 1,
    url: r.url,
    title: r.title,
    domain: r.domain,
    trust: r.trust,
  }));

  const sections = [`Web search results for "${query}":`];
  if (retrievedNote) sections.push(retrievedNote);

  if (instant_answer && instant_answer.text) {
    const label = instant_answer.type === "infobox"
      ? `Instant answer (infobox${instant_answer.title ? `: ${instant_answer.title}` : ""})`
      : "Instant answer";
    sections.push(`${label}:\n${instant_answer.text}`);
  }
  sections.push(
    "These search results are LIVE and more current than anything you learned during training. " +
    "If they answer the question -- even partially, even if it contradicts what you 'remember' -- use them as the truth. " +
    "Do not silently fall back to an older training-data fact when the search results contradict it; say what the results show and note the date. " +
    "If different sources disagree with each other, say so explicitly instead of picking one silently or inventing a resolution."
  );

  // Corroboration confidence, computed server-side from domain diversity
  // across results+news -- tells the model when to hedge instead of
  // stating a fact-sensitive claim as settled.
  if (confidence) {
    const confidenceNote = {
      high: "Multiple independent sources/domains corroborate this topic — confidence is high.",
      med: "Only two independent domains were found — corroboration is moderate. Note this if the claim is significant.",
      low: "Sources come from very few (or one) domain — corroboration is LOW. Explicitly flag uncertainty rather than stating facts as settled.",
    }[confidence.tier];
    if (confidenceNote) sections.push(confidenceNote);
  }

  if (hasResults) {
    sections.push(...results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.text}`));
  }

  const extraBlocks = [];
  if (science.length) {
    extraBlocks.push(
      "Research/academic paper results:\n" +
        science.map((s) => `- ${s.title} (${s.url})${s.snippet ? `: ${s.snippet}` : ""}`).join("\n")
    );
  }
  if (files.length) {
    extraBlocks.push(
      "PDF/document results:\n" + files.map((f) => `- ${f.title} (${f.url})`).join("\n")
    );
  }
  if (social.length) {
    extraBlocks.push(
      "Social/discussion results:\n" +
        social.map((s) => `- ${s.title} (${s.url})${s.snippet ? `: ${s.snippet}` : ""}`).join("\n")
    );
  }
  if (videos.length) {
    extraBlocks.push(
      "Video results:\n" + videos.map((v) => `- ${v.title} (${v.url})`).join("\n")
    );
  }
  if (videoTranscripts.length) {
    extraBlocks.push(
      "Video transcript text (use this the same way as page text above):\n" +
        videoTranscripts.map((v) => `- ${v.title} (${v.url})\n${v.text}`).join("\n\n")
    );
  }
  if (images.length) {
    extraBlocks.push(
      "Image results:\n" + images.map((im) => `- ${im.title} (${im.url})`).join("\n")
    );
  }
  if (news.length) {
    extraBlocks.push(
      "News results:\n" + news.map((n) => `- ${n.title} (${n.url})`).join("\n")
    );
  }
  if (shopping.length) {
    extraBlocks.push(
      "Shopping results:\n" +
        shopping.map((s) => `- ${s.title}${s.price ? ` (${s.price})` : ""} (${s.url})`).join("\n")
    );
  }
  if (extraBlocks.length) sections.push(extraBlocks.join("\n\n"));

  sections.push(
    hasResults
      ? "Use the numbered [1], [2], etc. results to answer and cite them inline with those numbers. You may also draw on the additional results listed above (research/documents/social/news/shopping/video transcripts) -- reference those by source name in prose, not with a [n] number."
      : "There are no numbered general-web results, but the results listed above are real search data -- use them to answer accurately, referencing the source by name (not a [n] number), and do not invent facts beyond what's listed."
  );

  return { contextBlock: sections.join("\n\n"), citations };
}

/**
 * Pulls the video/image/etc. results (if any) off a search response, for
 * rendering as media cards under the assistant's reply. These are never
 * sent to the model as context — display-only.
 */
export function extractMedia(searchResponse) {
  return {
    query: searchResponse.query || "",
    confidence: searchResponse.confidence || null,
    summary: searchResponse.summary || "",
    videos: searchResponse.videos || [],
    images: searchResponse.images || [],
    news: searchResponse.news || [],
    science: searchResponse.science || [],
    files: searchResponse.files || [],
    social: searchResponse.social || [],
    shopping: searchResponse.shopping || [],
  };
}
