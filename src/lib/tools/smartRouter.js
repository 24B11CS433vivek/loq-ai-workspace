// Smart Mode — intent router. When Smart Mode is toggled on in the
// composer, every send is classified first (a single fast, non-
// streaming Ollama call, temperature 0, JSON-only) so the right tool
// fires automatically -- image / svg / chart / diagram / browser /
// web search / plain chat -- instead of the user hand-toggling a
// mode button every time. Same call shape as chartEngine.js's
// parseChartPrompt(). Defaults to "chat" on any ambiguity or failure
// so Smart Mode never blindly fires a generation tool it isn't sure
// about -- worst case it just answers normally, same as before.

const MODES = ["image", "svg", "chart", "diagram", "browser", "search", "chat"];

const SYSTEM_PROMPT = `You are an intent router for a local AI chat app. Read the user's message and decide which single mode should handle it. Reply with ONLY a JSON object, no markdown fences, no commentary: {"mode": one of ["image","svg","chart","diagram","browser","search","chat"]}.

Rules:
- "image": user wants a picture/photo/illustration/artwork generated (e.g. "draw", "generate an image of", "create a picture of").
- "svg": user explicitly wants an SVG/vector icon/logo, not a photo.
- "chart": user wants data visualized as a bar/line/pie/etc chart or graph.
- "diagram": user wants a flowchart, sequence diagram, architecture diagram, mind map, or similar structural diagram, not a data chart.
- "browser": user wants you to actually browse/navigate/click/fill a real website or perform a live multi-step action on the web, rather than just look something up.
- "search": user is asking about current events, prices, or anything that needs a fresh live web lookup to answer accurately, but does NOT want a picture/chart/diagram/browsing task.
- "chat": anything else -- normal conversation, explanation, writing, code help, math, general knowledge you already know.

Only pick image/svg/chart/diagram/browser if the request is clearly and specifically asking to CREATE or RUN that kind of thing. If in doubt, pick "chat" or "search" instead of guessing a generation tool. Do not explain your choice.`;

export async function classifyIntent({ ollamaUrl, model = "qwen3:4b", text }) {
  try {
    const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) return "chat";
    const json = await res.json();
    const raw = (json?.message?.content || "").trim();
    const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return MODES.includes(parsed.mode) ? parsed.mode : "chat";
  } catch {
    // Router failure should never block sending the message.
    return "chat";
  }
}
