import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Composer from "./components/Composer.jsx";
import Message from "./components/Message.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import ArtifactPanel from "./components/ArtifactPanel.jsx";
import { streamChat, listModels } from "./lib/ollama";
import { getGreeting } from "./lib/greetings";
import { classifyIntent } from "./lib/tools/smartRouter";
import { runCompare } from "./lib/tools/compareModels";
import CompareSplitView from "./components/tools/CompareSplitView.jsx";
import { queryCollection } from "./lib/tools/rag";
import { webSearch, buildSearchContext, extractMedia } from "./lib/tools/websearch";
import { runBrowserTask } from "./lib/tools/browserAgent";
import BrowserCard, { GeneratingBrowserSkeleton } from "./components/tools/BrowserCard.jsx";
import KnowledgeModal from "./components/tools/KnowledgeModal.jsx";
import { analyzeData, chartData, dataUrlToFile, summarizeResult } from "./lib/tools/dataAnalysis";
import { generateFile, fileDownloadUrl } from "./lib/tools/generate";
import { convertFiles, convertDownloadUrl } from "./lib/tools/convert";
import { generateImage, enhanceImage, uploadImage, editImage, imageDownloadUrl } from "./lib/tools/imagegen";
import { GeneratingImageSkeleton } from "./components/tools/ImagePanel.jsx";
import CodePanel from "./components/tools/CodePanel.jsx";
import { GeneratingSvgSkeleton } from "./components/tools/SvgCard.jsx";
import { GeneratingChartSkeleton } from "./components/tools/ChartCard.jsx";
import { generateSvg } from "./lib/tools/svg";
import { parseChartPrompt } from "./lib/tools/chartEngine";
import { GeneratingDiagramSkeleton } from "./components/tools/DiagramCard.jsx";
import { parseDiagramPrompt } from "./lib/tools/diagram";
import { runTeacherTurn, loadTeacherProfile, recordTeacherTurn, topWeakSpots, computePhase, getAverageScore, suggestLevel } from "./lib/tools/teacherEngine";
import TeacherCard, { GeneratingTeacherSkeleton } from "./components/tools/TeacherCard.jsx";
import {
  loadSessions,
  saveSessions,
  loadSettings,
  saveSettings,
  loadTheme,
  saveTheme,
  newSession,
  loadPersonalities,
  IDENTITY_SYSTEM_PROMPT,
} from "./lib/storage";

// Every non-"writing" phase reuses the same pulse-orb animation with a
// different label, so every tool (search, RAG, data analysis, file
// generation) shows *something* instead of the chat sitting empty while
// a backend request is in flight. "writing" is the only phase that gets
// the token-by-token wave-bars, since it's the only one streaming text.
const GEN_STATE_LABELS = {
  thinking: "Thinking…",
  searching: "Searching the web…",
  retrieving: "Searching knowledge base…",
  analyzing: "Analyzing data…",
  generating: "Generating file…",
  "generating-image": "Generating image…",
  "thinking-svg": "Thinking through the design…",
  "generating-svg": "Generating SVG…",
  "generating-chart": "Rendering chart…",
  "generating-diagram": "Rendering diagram…",
  "running-browser-task": "Running browser task…",
  teaching: "Thinking it over…",
  "converting-files": "Converting files…",
};

export default function App() {
  const [sessions, setSessions] = useState(loadSessions);
  const [currentId, setCurrentId] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const [theme, setTheme] = useState(loadTheme);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 640);
  const [showSettings, setShowSettings] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactContent, setArtifactContent] = useState(null);

  // Phase 12C — Coding Agent panel. Keeps the existing <CodePanel/>
  // instance (and its unsaved edits) alive if the panel is reopened
  // while already showing the coding agent, instead of remounting a
  // fresh one on every toolbar click.
  const openCodePanel = () => {
    setArtifactOpen(true);
    setArtifactContent((prev) =>
      prev && prev.type === CodePanel ? prev : <CodePanel backendUrl={settings.backendUrl} ollamaUrl={settings.ollamaUrl} />
    );
  };

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genState, setGenState] = useState("thinking"); // "thinking" | "writing"
  // Image mode: toggled on via the composer's image button. While on,
  // the composer routes Enter/send straight to handleGenerateImage
  // instead of a normal chat message (see Composer.jsx's send()), so
  // no popover/extra click is needed per image.
  const [imageMode, setImageMode] = useState(false);
  // Phase 19B -- SVG quick-generate mode. Same "toggle on, then Enter
  // just does the thing" shape as imageMode above (see Composer.jsx's
  // send()).
  const [svgMode, setSvgMode] = useState(false);
  // Phase 19B (revised) -- Chart quick-generate mode. Same
  // "toggle on, then Enter just does the thing" shape as svgMode.
  const [chartMode, setChartMode] = useState(false);
  // Phase 19C -- Diagram quick-generate mode. Same shape as chartMode.
  const [diagramMode, setDiagramMode] = useState(false);
  const [browserMode, setBrowserMode] = useState(false);
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherLesson, setTeacherLesson] = useState("conversation");
  const [teacherLevel, setTeacherLevel] = useState("intermediate");
  const [teacherStyle, setTeacherStyle] = useState("professional");
  // Phase 9d — Enhance chain progress, keyed by `${sessionId}-${messageIndex}`
  // so multiple images (in different sessions or messages) can enhance
  // independently without a global "isGenerating" lock. Shape:
  // { status: "running"|"done"|"error", steps: [...], activeIndex, error }
  const [enhanceStates, setEnhanceStates] = useState({});
  const [editStates, setEditStates] = useState({});
  const [toast, setToast] = useState("");
  const [personalities] = useState(loadPersonalities);
  const [quote] = useState(getGreeting);
  const [allModels, setAllModels] = useState([]);
  const [compareMode, setCompareMode] = useState(false);
  const [compareModelA, setCompareModelA] = useState("");
  const [compareModelB, setCompareModelB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareText, setCompareText] = useState({ a: "", b: "" });
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparePrompt, setComparePrompt] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState(false);
  const [activeCollection, setActiveCollection] = useState("");
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  // Smart Mode — when on, the composer skips all manual tool toggles
  // and routes every send through classifyIntent() first (see
  // lib/tools/smartRouter.js + handleSmartSend below) to decide
  // image/svg/chart/diagram/browser/search/chat automatically.
  const [smartMode, setSmartMode] = useState(false);
  const [smartRouting, setSmartRouting] = useState(false);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    if (settings.ollamaUrl) listModels(settings.ollamaUrl).then(setAllModels);
  }, [settings.ollamaUrl]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [sessions, currentId, isGenerating]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const current = sessions.find((s) => s.id === currentId) || null;

  const updateSession = (id, patch) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const handleNewChat = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setCurrentId(s.id);
    setDraft("");
    setAttachments([]);
  };

  const handleDelete = (id) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === currentId) setCurrentId(null);
  };

  // Streams a completion for `messagesForApi` and appends/updates the
  // trailing assistant message in `baseMessages`. Shared by send + regenerate.
  const runAssistantTurn = async (sessionId, baseMessages, messagesForApi, citations = [], media = null, dataArtifact = null) => {
    if (!settings.model) {
      showToast("Pick a model in Settings first");
      setShowSettings(true);
      return;
    }
    setIsGenerating(true);
    setGenState("thinking");
    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    updateSession(sessionId, { messages: [...baseMessages, { role: "assistant", content: "", citations, media, dataArtifact }] });

    try {
      let full = "";
      await streamChat({
        baseUrl: settings.ollamaUrl,
        model: settings.model,
        messages: messagesForApi,
        signal: abortCtrl.signal,
        onFirstToken: () => setGenState("writing"),
        onToken: (delta) => {
          full += delta;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? { ...s, messages: [...baseMessages, { role: "assistant", content: full, citations, media, dataArtifact }] }
                : s
            )
          );
        },
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        // Show the real reason (bad model, VRAM, etc.) instead of
        // always blaming the connection -- that was masking every
        // model-specific failure behind the same wrong message.
        showToast(err.message || "Couldn't reach Ollama — check the URL in Settings");
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const buildDocContext = (messages) => {
    const docs = messages
      .flatMap((m) => m.attachments || [])
      .filter((a) => a.type === "document" && a.text);
    if (docs.length === 0) return "";
    return docs
      .map((a, i) => {
        const isLatest = i === docs.length - 1;
        return `[Document ${i + 1}/${docs.length}: ${a.name}${isLatest ? " — MOST RECENTLY UPLOADED" : ""}]\n${a.text}`;
      })
      .join("\n\n");
  };

  // Phase 7 — finds the most recently attached spreadsheet across the
  // conversation so far, same "most recent wins" convention as
  // buildDocContext above.
  const findLatestDataAttachment = (messages) => {
    const dataAtts = messages
      .flatMap((m) => m.attachments || [])
      .filter((a) => a.type === "data" && a.dataUrl);
    return dataAtts.length ? dataAtts[dataAtts.length - 1] : null;
  };

  const NOT_FOUND_MSG = "Information not found in the uploaded knowledge base.";

  const handleKnowledgeSend = async () => {
    if (!activeCollection) {
      showToast("Pick or create a Knowledge collection first");
      return;
    }
    const prompt = draft;
    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt, attachments: [] };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("retrieving");

    const recentHistory = session.messages
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);

    let result;
    try {
      result = await queryCollection(settings.backendUrl, {
        collection: activeCollection,
        query: prompt,
        top_k: 8,
        history: recentHistory,
      });
    } catch (e) {
      const errMsg = { role: "assistant", content: `⚠️ Knowledge query failed: ${e.message}` };
      updateSession(session.id, { messages: [...baseMessages, errMsg] });
      setIsGenerating(false);
      return;
    }

    const chunks = result.chunks || [];
    if (chunks.length === 0) {
      const notFoundMsg = { role: "assistant", content: NOT_FOUND_MSG };
      updateSession(session.id, { messages: [...baseMessages, notFoundMsg] });
      setIsGenerating(false);
      return;
    }

    const contextBlock = chunks
      .map((c, i) => `[Source ${i + 1}: ${c.source}]\n${c.text}`)
      .join("\n\n");

    const strictSystem = {
      role: "system",
      content: `You are a careful research assistant answering strictly from the reference material below — never from general knowledge, training data, or assumptions outside it.

Before answering, work through this silently (do not show these steps in your reply, only the final answer):
- What is the question actually asking for — a name, a fact, a comparison, a list, a reason?
- Go source by source: does this source contain information that actually answers it, partially answers it, or is it just topically related without answering it?
- If the literal wording of the question isn't in the text, look for the same fact stated differently (e.g. a role, a relationship, a synonym, a number written in another form) before concluding it's missing.
- Decide: is there a real answer here, a partial answer, or genuinely nothing relevant?

Then answer:
1. If you found a real or partial answer, state it directly and concretely — the actual fact, not a description of where it might be. If only partial, say clearly what's covered and what isn't.
2. Use bullet points or a table only when the material is naturally structured that way (lists, comparisons, schedules, data); otherwise write plain sentences.
3. If sources disagree, say so briefly instead of silently picking one.
4. Never output "Source", "Document N", filenames, or any citation marker — write as if you simply know the fact. If you need to indicate origin, name it in a normal sentence (e.g. "the registration form doesn't list this").
5. Be concise — no filler, no repeated disclaimers, no hedging beyond what the material actually warrants.
6. Only if, after genuinely checking every source as above, nothing answers even partially, respond with EXACTLY this and nothing else: "${NOT_FOUND_MSG}"

Reference material:

${contextBlock}`,
    };

    const apiMessages = [strictSystem, { role: "user", content: prompt }];
    await runAssistantTurn(session.id, baseMessages, apiMessages);
  };

  const handleSend = async (forceSearch = false) => {
    if (!draft.trim() && attachments.length === 0) return;

    if (knowledgeMode) {
      await handleKnowledgeSend();
      return;
    }

    if (compareMode) {
      if (!compareModelA || !compareModelB) {
        showToast("Pick two models to compare");
        return;
      }
      const prompt = draft;
      setComparePrompt(prompt);
      setDraft("");
      setCompareLoading(true);
      setCompareText({ a: "", b: "" });
      setCompareOpen(true);
      try {
        const { modelA, modelB } = await runCompare({
          baseUrl: settings.ollamaUrl,
          modelA: compareModelA,
          modelB: compareModelB,
          systemPrompt: current?.systemPrompt || "",
          prompt,
        });
        setCompareText({ a: modelA, b: modelB });
      } catch {
        showToast("Compare failed — check Ollama connection");
      } finally {
        setCompareLoading(false);
      }
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: draft, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? draft.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    const pendingDraft = draft;
    setDraft("");
    setAttachments([]);

    // Show *something* immediately instead of a blank chat while any
    // pre-LLM tool call (search, data analysis) is in flight — the
    // state-row below reads isGenerating/genState the same way it does
    // for token streaming.
    setIsGenerating(true);
    setGenState((searchMode || forceSearch) ? "searching" : "thinking");

    let searchContextBlock = "";
    let searchCitations = [];
    let searchMedia = null;
    if (searchMode || forceSearch) {
      try {
        const searchResp = await webSearch(pendingDraft, settings.backendUrl);
        const { contextBlock, citations } = buildSearchContext(searchResp);
        searchContextBlock = contextBlock;
        searchCitations = citations;
        searchMedia = extractMedia(searchResp);
      } catch (e) {
        console.error("[websearch] failed:", e);
        showToast("Web search failed — continuing without it");
      }
    }

    const docContext = buildDocContext(baseMessages);

    // Phase 7 — if a spreadsheet is attached anywhere in this
    // conversation, plan+run an analysis for the current question and
    // render the table/chart in the artifact panel alongside the reply.
    let dataContextBlock = "";
    let dataArtifactPayload = null;
    const dataAttachment = findLatestDataAttachment(baseMessages);
    if (dataAttachment) {
      setGenState("analyzing");
      try {
        const file = dataUrlToFile(dataAttachment.dataUrl, dataAttachment.name);
        const { operation, result } = await analyzeData({
          backendUrl: settings.backendUrl,
          file,
          question: pendingDraft,
        });

        let chartResult = null;
        try {
          chartResult = await chartData({ backendUrl: settings.backendUrl, file, operation });
        } catch (e) {
          console.error("[data] chart generation failed:", e);
        }

        // Rendered inline in the chat message itself (see Message.jsx),
        // not the side ArtifactPanel — plain data only, since this has
        // to survive the localStorage session round-trip like any other
        // message field.
        dataArtifactPayload = {
          filename: dataAttachment.name,
          operation,
          result,
          imageBase64: chartResult?.image_base64,
        };

        dataContextBlock = `[Data analysis on ${dataAttachment.name} — operation: ${operation.op}]\n${summarizeResult(result)}`;
      } catch (e) {
        console.error("[data] analysis failed:", e);
        // Previously this just toasted and fell through to a normal chat
        // completion with zero data context — which is exactly how you
        // get a confident, wrong, hallucinated answer instead of a clear
        // failure. Stop the turn and say so plainly instead.
        const failMsg = {
          role: "assistant",
          content: `⚠️ Data analysis failed for **${dataAttachment.name}**: ${e.message}\n\nThe backend's /tools/data pipeline did not run — this reply was not generated from the spreadsheet. Check that the backend is running and reachable at ${settings.backendUrl}, then try again.`,
        };
        updateSession(session.id, { messages: [...baseMessages, failMsg] });
        showToast("Data analysis failed — see chat for details");
        setIsGenerating(false);
        return;
      }
    }

    setGenState("thinking");
    const sysMsgs = [{ role: "system", content: session.systemPrompt ? `${IDENTITY_SYSTEM_PROMPT}\n\n${session.systemPrompt}` : IDENTITY_SYSTEM_PROMPT }];

    // Fresh, per-turn context (live search results, uploaded docs) is placed
    // LAST -- immediately before the current user question -- instead of at
    // the very front of the message array. With small/local models especially,
    // whatever sits closest to the point of generation dominates attention.
    // Burying live search results under the whole prior conversation let the
    // model latch onto its own earlier "I don't have real-time access"
    // answers from earlier turns instead of the fresh data it was just given.
    const priorMessages = baseMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const currentUserMsg = baseMessages[baseMessages.length - 1];
    const freshContextMsgs = [
      ...(searchContextBlock ? [{ role: "system", content: `${searchContextBlock}

IMPORTANT: The above search results were retrieved just now, specifically for the question below. They are real and current. Answer using them even if something you said earlier in this same conversation claimed you lack real-time/internet access -- that was true only for turns where no search was performed. For THIS question, you have live data above; use it and do not say you can't access current information.` }] : []),
      ...(docContext ? [{ role: "system", content: `You have access to the following documents uploaded during this conversation, in upload order. Before answering any question about a document:
1. Check if the user's question names or hints at a specific file (filename, extension like "excel"/"xlsx"/"pdf"/"sheet", or a topic that clearly matches one document's content).
2. If so, answer from THAT document, even if it was uploaded earlier — not necessarily the most recent one.
3. Only default to the most recently uploaded document when the user says vague things like "this" or "it" with no other identifying clues.
4. If genuinely unsure which document the user means, ask them to clarify instead of guessing.

Documents:
\n\n${docContext}` }] : []),
      ...(dataContextBlock ? [{ role: "system", content: `${dataContextBlock}

The analysis above was just computed from the attached spreadsheet using a safe, constrained operation (not arbitrary code) and is being shown to the user right now as a table and chart in a side panel. Rules for using it:
1. Describe/answer using ONLY the numbers and rows given above. Do not say you can't read spreadsheets or lack access to the file.
2. Do NOT compute, estimate, or invent any statistic that is not literally present above (no new averages, no counts by a category that wasn't grouped, no "rough breakdown" buckets, no salary/experience ranges).
3. If the returned rows/table above already lists specific matches, list ALL of them by name — never summarize or drop rows from what's given. Before you answer, COUNT the rows in the "Rows:" JSON yourself and make sure the number you state matches that count exactly — do not estimate or round it.
4. For correlation, use ONLY the strength label already given to you in the text above (e.g. "weak", "moderate", "strong", "negligible") — never judge or restate the strength yourself from the raw number, and never call a correlation "strong" unless that exact word appears in the label given to you.
5. Do NOT describe scatter plots, trends, or relationships beyond the exact correlation values given.
6. If the user asks about something this operation didn't compute (e.g. a breakdown by a column that wasn't grouped), say plainly that this result doesn't cover that, instead of guessing.` }] : []),
    ];
    const apiMessages = [
      ...sysMsgs,
      ...priorMessages,
      ...freshContextMsgs,
      { role: currentUserMsg.role, content: currentUserMsg.content },
    ];
    if (searchCitations.length > 0) {
      updateSession(session.id, { messages: baseMessages, title, pendingCitations: searchCitations });
    }
    await runAssistantTurn(session.id, baseMessages, apiMessages, searchCitations, searchMedia, dataArtifactPayload);
  };

  // Edit a past user message: drop it and everything after it, and
  // refill the composer so the person can revise and resend.
  const handleEditMessage = (index) => {
    if (!current || isGenerating) return;
    const msg = current.messages[index];
    updateSession(current.id, { messages: current.messages.slice(0, index) });
    setDraft(msg.content);
    // "convert-file" attachments are persisted without their dataUrl
    // (the raw bytes aren't kept in chat history, see handleGenerateConvert)
    // so they can never be validly resent -- restoring them here would
    // crash later in dataUrlToFile(). Drop them and tell the person to
    // re-attach instead of resurfacing a dead attachment chip.
    const restorable = msg.attachments || [];
    const hasDeadConvertFiles = restorable.some((a) => a.type === "convert-file" && !a.dataUrl);
    setAttachments(restorable.filter((a) => !(a.type === "convert-file" && !a.dataUrl)));
    if (hasDeadConvertFiles) {
      showToast("The attached file's data wasn't kept in history — please re-attach it before resending");
    }
  };

  // Regenerate an assistant reply: drop it and everything after it,
  // then re-run the model on the conversation up to that point.
  const handleRegenerate = async (index) => {
    if (!current || isGenerating) return;
    if (current.messages[index]?.teacherArtifact) return handleRegenerateTeacherMessage(index);
    const baseMessages = current.messages.slice(0, index);
    updateSession(current.id, { messages: baseMessages });
    const apiMessages = baseMessages.map((m) => ({ role: m.role, content: m.content }));
    await runAssistantTurn(current.id, baseMessages, apiMessages);
  };

  // Phase 8 (revised) — "Generate File" used to hand its result straight
  // to <ArtifactPanel/>, opening a side panel disconnected from the
  // conversation. Now it runs as a normal chat turn: your typed topic
  // becomes the user message, and the download card renders inline
  // under the assistant reply (Message.jsx -> fileArtifact), same place
  // dataArtifact already renders for Phase 7.
  const handleGenerateFile = async ({ outputFormat }) => {
    const prompt = draft.trim();
    const docAttachments = attachments.filter((a) => a.type === "document" && a.text);
    const pastedText = docAttachments.map((a) => a.text).join("\n\n");
    const otherAttachments = attachments.filter((a) => !(a.type === "document" && a.text));

    if (!prompt && !pastedText) {
      showToast("Type a prompt, paste text, or attach a file first, then Generate");
      return;
    }
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt || "(generate from attached content)", attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? (prompt || "Generated file").slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setAttachments(otherAttachments);
    setIsGenerating(true);
    setGenState("generating");

    let assistantMsg;
    try {
      const result = await generateFile({
        backendUrl: settings.backendUrl,
        outputFormat,
        prompt,
        pastedText,
        files: [],
        model: settings.model,
      });
      assistantMsg = {
        role: "assistant",
        content: `Here's your .${outputFormat} file — download it below.`,
        fileArtifact: {
          kind: result.kind,
          filename: result.filename,
          downloadUrl: fileDownloadUrl(settings.backendUrl, result.url),
          title: result.title,
          meta: result,
        },
      };
    } catch (e) {
      console.error("[generate] failed:", e);
      assistantMsg = { role: "assistant", content: "", fileArtifact: { kind: outputFormat, error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Conversion Mode — same "runs as a normal chat turn" shape as
  // handleGenerateFile above. onGenerateConvert fires from Composer's
  // send() once a "convert-file" attachment is present (see
  // ConvertToggle.jsx); dataUrlToFile() turns each attachment's stored
  // base64 back into a real File before POSTing to /tools/convert, so
  // the original bytes -- not extracted text -- are what get converted.
  const handleGenerateConvert = async () => {
    const prompt = draft.trim();
    const convertAttachments = attachments.filter((a) => a.type === "convert-file");
    const otherAttachments = attachments.filter((a) => a.type !== "convert-file");

    if (convertAttachments.length === 0) {
      showToast("Attach a file to convert first, then type what to convert it to");
      return;
    }
    if (!prompt) {
      showToast("Type what to convert to (e.g. \"convert to png\"), then press Enter");
      return;
    }
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const persistedAttachments = attachments.map((a) => (a.type === "convert-file" ? { id: a.id, type: a.type, name: a.name, mime: a.mime } : a));
    const userMsg = { role: "user", content: prompt, attachments: persistedAttachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setAttachments(otherAttachments);
    setIsGenerating(true);
    setGenState("converting-files");

    let assistantMsg;
    try {
      const files = convertAttachments.map((a) => dataUrlToFile(a.dataUrl, a.name));
      const { results } = await convertFiles({ backendUrl: settings.backendUrl, files, prompt });
      assistantMsg = {
        role: "assistant",
        content: results.length === 1 ? `Here's your converted file — download it below.` : `Converted into ${results.length} files — download them below.`,
        convertArtifact: {
          results: results.map((r) => ({ ...r, downloadUrl: convertDownloadUrl(settings.backendUrl, r.url) })),
        },
      };
    } catch (e) {
      console.error("[convert] failed:", e);
      assistantMsg = { role: "assistant", content: "", convertArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Phase 9c — Creative Studio (generate). Same "runs as a normal chat
  // turn" shape as handleGenerateFile above: typed prompt -> user
  // message, ComfyUI request happens behind the shared state-row
  // (pulse-orb + "Generating image…"), then the assistant reply carries
  // imageArtifact, which Message.jsx renders as an inline ImageCard
  // with its own blurred-reveal animation once the PNG actually loads.
  const handleGenerateImage = async ({ style } = {}) => {
    // No style passed (e.g. the image-mode Enter-to-generate path) ->
    // use the default chosen in Settings, illustrative unless changed.
    const useStyle = style || settings.defaultImageStyle || "illustrative";
    const prompt = draft.trim();
    if (!prompt) {
      showToast("Type what you want to see, then click Generate Image");
      return;
    }
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("generating-image");

    let assistantMsg;
    try {
      const result = await generateImage({
        backendUrl: settings.backendUrl,
        prompt,
        style: useStyle,
      });
      assistantMsg = {
        role: "assistant",
        content: "Here's your image — enhance it or download below.",
        imageArtifact: {
          filename: result.filename,
          url: imageDownloadUrl(settings.backendUrl, result.url),
          prompt: result.prompt,
          style: result.style,
        },
      };
    } catch (e) {
      console.error("[imagegen] failed:", e);
      assistantMsg = { role: "assistant", content: "", imageArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Phase 19B (revised) — Chart quick-generate. Same "runs as a normal
  // chat turn" shape as handleGenerateSvg below: typed prompt -> user
  // message, parseChartPrompt() asks Ollama to turn it into
  // {type, labels, values}, then the assistant reply carries
  // chartArtifact, which Message.jsx renders as an inline ChartCard.
  // Model used: settings.chartModel if explicitly set in Settings,
  // else settings.model (your main selected model), else qwen3:4b
  // as a last resort on a completely unconfigured install -- never
  // hardcoded ahead of whatever you've actually picked. No backend
  // round-trip -- talks to Ollama directly, same as chartEngine.js's
  // other helpers.
  const handleGenerateChart = async () => {
    const prompt = draft.trim();
    if (!prompt) {
      showToast("Type what you want charted, then press Enter");
      return;
    }
    if (!settings.ollamaUrl) {
      showToast("Set an Ollama URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("generating-chart");

    let assistantMsg;
    try {
      const result = await parseChartPrompt({
        ollamaUrl: settings.ollamaUrl,
        model: settings.chartModel || settings.model || undefined,
        prompt,
      });
      assistantMsg = {
        role: "assistant",
        content: "Here's your chart — hover for values, or switch the type and download it below.",
        chartArtifact: {
          type: result.type,
          labels: result.labels,
          values: result.values,
          prompt,
        },
      };
    } catch (e) {
      console.error("[chart] generation failed:", e);
      assistantMsg = { role: "assistant", content: "", chartArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Phase 19C — Diagram quick-generate. Same "runs as a normal chat
  // turn" shape as handleGenerateChart above: typed prompt -> user
  // message, parseDiagramPrompt() asks Ollama for raw Mermaid code,
  // then the assistant reply carries diagramArtifact, which
  // Message.jsx renders as an inline DiagramCard (static SVG via
  // mermaid.render(), not a live canvas). Model used:
  // settings.diagramModel if explicitly set in Settings, else
  // settings.model, else qwen3:4b as a last resort.
  const handleGenerateDiagram = async () => {
    const prompt = draft.trim();
    if (!prompt) {
      showToast("Type what you want diagrammed, then press Enter");
      return;
    }
    if (!settings.ollamaUrl) {
      showToast("Set an Ollama URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("generating-diagram");

    let assistantMsg;
    try {
      const code = await parseDiagramPrompt({
        ollamaUrl: settings.ollamaUrl,
        model: settings.diagramModel || settings.model || undefined,
        prompt,
      });
      assistantMsg = {
        role: "assistant",
        content: "Here's your diagram — switch the theme or grab the SVG/Mermaid source below.",
        diagramArtifact: { code, prompt },
      };
    } catch (e) {
      console.error("[diagram] generation failed:", e);
      assistantMsg = { role: "assistant", content: "", diagramArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Browser automation quick-run. Same "runs as a normal chat turn"
  // shape as handleGenerateDiagram above: typed task -> user message,
  // runBrowserTask() posts to /tools/browser/task and awaits the full
  // plan-act-observe loop server-side, then the assistant reply carries
  // browserArtifact, which Message.jsx renders as an inline BrowserCard.
  const handleGenerateBrowserTask = async () => {
    const task = draft.trim();
    if (!task) {
      showToast("Type the task you want the browser to do, then press Enter");
      return;
    }
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: task, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? task.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("running-browser-task");

    let assistantMsg;
    try {
      const result = await runBrowserTask(task, settings.backendUrl);
      assistantMsg = {
        role: "assistant",
        content: result.summary || "Browser task finished.",
        browserArtifact: { steps: result.steps, summary: result.summary },
      };
    } catch (e) {
      console.error("[browser] task failed:", e);
      assistantMsg = { role: "assistant", content: "", browserArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // English Teacher Mode -- same "runs as a normal chat turn" shape as
  // handleGenerateBrowserTask above, but talks straight to Ollama
  // (like chartEngine.js/diagram.js) since a lesson turn is just a
  // JSON-schema chat completion, no backend round-trip needed. Voice
  // in/out reuse the mic button and per-message speaker button that
  // already exist -- nothing extra to wire there.

  // Auto-starts a Teacher Mode lesson turn with no student input yet --
  // fires the moment the mode is switched on or the lesson type is
  // changed, so the teacher leads the session like a real tutor instead
  // of sitting there waiting for the student to type first.
  const handleStartTeacherLesson = async (lesson) => {
    if (!settings.ollamaUrl) {
      showToast("Set an Ollama URL in Settings first");
      return;
    }
    if (isGenerating) return;

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    setIsGenerating(true);
    setGenState("teaching");

    let assistantMsg;
    try {
      const profile = loadTeacherProfile();
      const weakSpots = topWeakSpots(profile);
      const phase = computePhase(profile.turns || 0);
      const history = session.messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const result = await runTeacherTurn({
        ollamaUrl: settings.ollamaUrl,
        model: settings.teacherModel || settings.model || undefined,
        lesson,
        level: teacherLevel,
        style: teacherStyle,
        message: "",
        history,
        weakSpots,
        isStart: true,
        recentTopics: profile.recentTopics || [],
        phase,
      });
      const updatedProfile = recordTeacherTurn(profile, result.mistake_tags, result.topicUsed, result.score);
      const nextLevel = suggestLevel(teacherLevel, updatedProfile);
      if (nextLevel !== teacherLevel) {
        setTeacherLevel(nextLevel);
        showToast(`Level adjusted to ${nextLevel} based on your recent progress`);
      }
      assistantMsg = {
        role: "assistant",
        content: result.reply || "",
        teacherArtifact: {
          lesson,
          phase,
          corrected: result.corrected,
          correctionNote: result.correction_note,
          category: result.category,
          severity: result.severity,
          score: result.score,
          nextFocus: result.next_focus,
          quiz: result.quiz,
          story: result.story,
          weakSpots: topWeakSpots(updatedProfile),
          avgScore: getAverageScore(updatedProfile),
        },
      };
    } catch (e) {
      console.error("[teacher] lesson start failed:", e);
      assistantMsg = { role: "assistant", content: "", teacherArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...session.messages, assistantMsg] });
  };

  // Turning Teacher Mode on immediately starts a lesson (no typing
  // required first); turning it off is just a flag flip.
  const handleToggleTeacherMode = () => {
    const next = !teacherMode;
    setTeacherMode(next);
    if (next) handleStartTeacherLesson(teacherLesson);
  };

  // Switching lesson type mid-session (conversation -> quiz -> story...)
  // restarts with an opening turn for the new lesson type, same as
  // first turning the mode on.
  const handleSetTeacherLesson = (lesson) => {
    setTeacherLesson(lesson);
    if (teacherMode) handleStartTeacherLesson(lesson);
  };

  // Manual level/style overrides -- adaptive leveling (see suggestLevel)
  // can still move teacherLevel automatically between turns; this is
  // just the student picking a starting point or correcting the guess.
  const handleSetTeacherLevel = (level) => setTeacherLevel(level);
  const handleSetTeacherStyle = (style) => setTeacherStyle(style);

  // Fires when the student clicks an answer on the *last* quiz question
  // in the *last* message (wired below) -- generates the next single
  // question automatically so quiz mode keeps going on its own until
  // the student switches lesson type or turns Teacher Mode off.
  const handleContinueTeacherQuiz = async () => {
    if (!teacherMode || teacherLesson !== "quiz") return;
    if (isGenerating) return;
    const session = current;
    if (!session) return;

    setIsGenerating(true);
    setGenState("teaching");

    let assistantMsg;
    try {
      const profile = loadTeacherProfile();
      const weakSpots = topWeakSpots(profile);
      const phase = computePhase(profile.turns || 0);
      const history = session.messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const result = await runTeacherTurn({
        ollamaUrl: settings.ollamaUrl,
        model: settings.teacherModel || settings.model || undefined,
        lesson: "quiz",
        level: teacherLevel,
        style: teacherStyle,
        message: "",
        history,
        weakSpots,
        isContinue: true,
        phase,
      });
      const updatedProfile = recordTeacherTurn(profile, result.mistake_tags, null, result.score);
      assistantMsg = {
        role: "assistant",
        content: result.reply || "",
        teacherArtifact: {
          lesson: "quiz",
          phase,
          corrected: result.corrected,
          correctionNote: result.correction_note,
          category: result.category,
          severity: result.severity,
          score: result.score,
          nextFocus: result.next_focus,
          quiz: result.quiz,
          story: result.story,
          weakSpots: topWeakSpots(updatedProfile),
          avgScore: getAverageScore(updatedProfile),
        },
      };
    } catch (e) {
      console.error("[teacher] quiz continue failed:", e);
      assistantMsg = { role: "assistant", content: "", teacherArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...session.messages, assistantMsg] });
  };
  const handleContinueTeacherStory = async () => {
    if (!teacherMode || teacherLesson !== "story") return;
    if (isGenerating) return;
    const session = current;
    if (!session) return;
    setIsGenerating(true);
    setGenState("teaching");
    let assistantMsg;
    try {
      const profile = loadTeacherProfile();
      const weakSpots = topWeakSpots(profile);
      const phase = computePhase(profile.turns || 0);
      const history = session.messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const result = await runTeacherTurn({
        ollamaUrl: settings.ollamaUrl,
        model: settings.teacherModel || settings.model || undefined,
        lesson: "story",
        level: teacherLevel,
        style: teacherStyle,
        message: "",
        history,
        weakSpots,
        isContinueStory: true,
        phase,
      });
      const updatedProfile = recordTeacherTurn(profile, result.mistake_tags, null, result.score);
      assistantMsg = {
        role: "assistant",
        content: result.reply || "",
        teacherArtifact: {
          lesson: "story",
          phase,
          corrected: result.corrected,
          correctionNote: result.correction_note,
          category: result.category,
          severity: result.severity,
          score: result.score,
          nextFocus: result.next_focus,
          quiz: result.quiz,
          story: result.story,
          weakSpots: topWeakSpots(updatedProfile),
          avgScore: getAverageScore(updatedProfile),
        },
      };
    } catch (e) {
      console.error("[teacher] story continue failed:", e);
      assistantMsg = { role: "assistant", content: "", teacherArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }
    updateSession(session.id, { messages: [...session.messages, assistantMsg] });
  };
  const handleRegenerateTeacherMessage = async (index) => {
    if (!current || isGenerating) return;
    const artifact = current.messages[index]?.teacherArtifact;
    if (!artifact) return;
    const prevMsg = current.messages[index - 1];
    const isReplyTurn = !!prevMsg && prevMsg.role === "user";
    const baseMessages = current.messages.slice(0, index);
    updateSession(current.id, { messages: baseMessages });
    setIsGenerating(true);
    setGenState("teaching");
    let assistantMsg;
    try {
      const profile = loadTeacherProfile();
      const weakSpots = topWeakSpots(profile);
      const phase = artifact.phase || computePhase(profile.turns || 0);
      const historySource = isReplyTurn ? baseMessages.slice(0, -1) : baseMessages;
      const history = historySource.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const result = await runTeacherTurn({
        ollamaUrl: settings.ollamaUrl,
        model: settings.teacherModel || settings.model || undefined,
        lesson: artifact.lesson,
        level: teacherLevel,
        style: teacherStyle,
        message: isReplyTurn ? prevMsg.content : "",
        history,
        weakSpots,
        isStart: !isReplyTurn,
        phase,
      });
      const updatedProfile = recordTeacherTurn(profile, result.mistake_tags, result.topicUsed, result.score);
      assistantMsg = {
        role: "assistant",
        content: result.reply || "",
        teacherArtifact: {
          lesson: artifact.lesson,
          phase,
          corrected: result.corrected,
          correctionNote: result.correction_note,
          category: result.category,
          severity: result.severity,
          score: result.score,
          nextFocus: result.next_focus,
          quiz: result.quiz,
          story: result.story,
          weakSpots: topWeakSpots(updatedProfile),
          avgScore: getAverageScore(updatedProfile),
        },
      };
    } catch (e) {
      console.error("[teacher] regenerate failed:", e);
      assistantMsg = { role: "assistant", content: "", teacherArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }
    updateSession(current.id, { messages: [...baseMessages, assistantMsg] });
  };
  const handleGenerateTeacherTurn = async () => {
    const message = draft.trim();
    if (!message) {
      showToast("Type your answer, then press Enter");
      return;
    }
    if (!settings.ollamaUrl) {
      showToast("Set an Ollama URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: message, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? message.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState("teaching");

    let assistantMsg;
    try {
      const profile = loadTeacherProfile();
      const weakSpots = topWeakSpots(profile);
      const phase = computePhase(profile.turns || 0);
      const history = session.messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const result = await runTeacherTurn({
        ollamaUrl: settings.ollamaUrl,
        model: settings.teacherModel || settings.model || undefined,
        lesson: teacherLesson,
        level: teacherLevel,
        style: teacherStyle,
        message,
        history,
        weakSpots,
        phase,
      });
      const updatedProfile = recordTeacherTurn(profile, result.mistake_tags, null, result.score);
      const nextLevel = suggestLevel(teacherLevel, updatedProfile);
      if (nextLevel !== teacherLevel) {
        setTeacherLevel(nextLevel);
        showToast(`Level adjusted to ${nextLevel} based on your recent progress`);
      }
      assistantMsg = {
        role: "assistant",
        content: result.reply || "",
        teacherArtifact: {
          lesson: teacherLesson,
          phase,
          corrected: result.corrected,
          correctionNote: result.correction_note,
          category: result.category,
          severity: result.severity,
          score: result.score,
          nextFocus: result.next_focus,
          quiz: result.quiz,
          story: result.story,
          weakSpots: topWeakSpots(updatedProfile),
          avgScore: getAverageScore(updatedProfile),
        },
      };
    } catch (e) {
      console.error("[teacher] turn failed:", e);
      assistantMsg = { role: "assistant", content: "", teacherArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

    // Phase 19B — SVG quick-generate. Same "runs as a normal chat turn"
  // shape as handleGenerateImage above: typed prompt -> user message,
  // backend request happens behind the shared state-row (pulse-orb +
  // "Thinking through the design…" then "Generating SVG…"), then the
  // assistant reply carries svgArtifact, which Message.jsx renders as
  // an inline SvgCard. Uses settings.svgModel (any locally pulled
  // Ollama model) instead of a hardcoded one, and settings.svgThink to
  // control the pre-generation design-brief pass.
  const handleGenerateSvg = async ({ style } = {}) => {
    const useStyle = style || settings.defaultSvgStyle || "icon";
    const prompt = draft.trim();
    if (!prompt) {
      showToast("Type what you want as an SVG, then press Enter");
      return;
    }
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: prompt, attachments };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? prompt.slice(0, 40) || "New chat" : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setDraft("");
    setIsGenerating(true);
    setGenState(settings.svgThink !== false ? "thinking-svg" : "generating-svg");

    let assistantMsg;
    try {
      const result = await generateSvg({
        backendUrl: settings.backendUrl,
        prompt,
        style: useStyle,
        model: settings.svgModel,
        think: settings.svgThink !== false,
      });
      // Flip to the "generating" label once the (optional) thinking
      // pass has returned and the SVG itself is the only thing left
      // — generateSvg() awaits the whole chain, so this fires just
      // before the skeleton unmounts, but keeps the label honest if a
      // slow request lingers in the UI for a tick.
      setGenState("generating-svg");
      assistantMsg = {
        role: "assistant",
        content: "Here's your SVG — copy the code or download it below.",
        svgArtifact: {
          svg_code: result.svg_code,
          prompt,
          style: useStyle,
          model: result.model,
          plan: result.plan,
        },
      };
    } catch (e) {
      console.error("[svg] generation failed:", e);
      assistantMsg = { role: "assistant", content: "", svgArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Smart Mode dispatcher — classifies the typed message, then calls
  // straight into the same handlers the manual toggle buttons use
  // (handleGenerateImage/Svg/Chart/Diagram/BrowserTask, or handleSend
  // itself for plain chat/search) so the actual generation logic is
  // never duplicated. Explicit knowledge/compare modes still win if
  // the user has one of those on — smart routing only decides among
  // image/svg/chart/diagram/browser/search/chat.
  const handleSmartSend = async () => {
    if (!draft.trim() && attachments.length === 0) return;
    if (knowledgeMode || compareMode) {
      await handleSend();
      return;
    }
    const text = draft.trim();
    setSmartRouting(true);
    setIsGenerating(true);
    setGenState("thinking");
    let mode = "chat";
    try {
      mode = await classifyIntent({
        ollamaUrl: settings.ollamaUrl,
        model: settings.model || "qwen3:4b",
        text,
      });
    } catch {
      mode = "chat";
    } finally {
      setSmartRouting(false);
    }
    if (mode === "image" && settings.backendUrl) return handleGenerateImage();
    if (mode === "svg" && settings.backendUrl) return handleGenerateSvg();
    if (mode === "chart") return handleGenerateChart();
    if (mode === "diagram") return handleGenerateDiagram();
    if (mode === "browser" && settings.backendUrl) return handleGenerateBrowserTask();
    if (mode === "search") return handleSend(true);
    setIsGenerating(false);
    return handleSend();
  };

  // Upload mode — settings.imageInputMode === "upload". Same shape as
  // handleGenerateImage above (new chat turn, shared isGenerating/
  // genState state-row, imageArtifact on the assistant message) but
  // skips ComfyUI entirely: the file the user picked goes straight to
  // /tools/image/upload, and the returned filename flows into the
  // exact same handleEnhanceImage/ImageCard pipeline as a generated
  // image, so Enhance + Download just work on it unchanged.
  const handleUploadImage = async (file) => {
    if (!file) return;
    if (!settings.backendUrl) {
      showToast("Set a backend URL in Settings first");
      return;
    }

    let session = current;
    if (!session) {
      session = newSession();
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
    }

    const userMsg = { role: "user", content: `Uploaded photo: ${file.name}`, attachments: [] };
    const baseMessages = [...session.messages, userMsg];
    const title = session.messages.length === 0 ? file.name.slice(0, 40) : session.title;
    updateSession(session.id, { messages: baseMessages, title });
    setIsGenerating(true);
    setGenState("generating-image");

    let assistantMsg;
    try {
      const result = await uploadImage({ backendUrl: settings.backendUrl, file });
      assistantMsg = {
        role: "assistant",
        content: "Photo uploaded — enhance it or download below.",
        imageArtifact: {
          filename: result.filename,
          url: imageDownloadUrl(settings.backendUrl, result.url),
          prompt: file.name,
          style: "",
        },
      };
    } catch (e) {
      console.error("[imageupload] failed:", e);
      assistantMsg = { role: "assistant", content: "", imageArtifact: { error: e.message } };
    } finally {
      setIsGenerating(false);
    }

    updateSession(session.id, { messages: [...baseMessages, assistantMsg] });
  };

  // Phase 9d — Enhance chain, wired to /tools/image/enhance via
  // enhanceImage() in imagegen.js. Unlike generate/file above, this
  // doesn't run as a new chat turn — it mutates the imageArtifact on
  // an existing assistant message in place, so it gets its own small
  // per-message state (enhanceStates) instead of the shared
  // isGenerating/genState state-row. The backend returns only once the
  // whole chain finishes, so the step-by-step highlight below is a
  // steady client-side walk through the selected steps rather than
  // real progress from the server.
  const handleEnhanceImage = async (messageIndex, options) => {
    const session = current;
    if (!session) return;
    const msg = session.messages[messageIndex];
    if (!msg?.imageArtifact?.filename) return;

    const steps = ["face_fix", "upscale", "remove_bg", "color_grade"].filter((k) => options[k]);
    if (steps.length === 0) {
      showToast("Enable at least one enhancement step");
      return;
    }

    const key = `${session.id}-${messageIndex}`;
    setEnhanceStates((prev) => ({ ...prev, [key]: { status: "running", steps, activeIndex: 0 } }));

    const stepTimer = setInterval(() => {
      setEnhanceStates((prev) => {
        const s = prev[key];
        if (!s || s.status !== "running") return prev;
        return { ...prev, [key]: { ...s, activeIndex: Math.min(s.activeIndex + 1, s.steps.length - 1) } };
      });
    }, 1100);

    try {
      const result = await enhanceImage({
        backendUrl: settings.backendUrl,
        filename: msg.imageArtifact.filename,
        faceFix: options.face_fix,
        upscale: options.upscale,
        upscaleFactor: options.upscale_factor || 2,
        removeBg: options.remove_bg,
        colorGrade: options.color_grade,
      });

      updateSession(session.id, {
        messages: session.messages.map((m, i) =>
          i === messageIndex
            ? {
                ...m,
                imageArtifact: {
                  ...m.imageArtifact,
                  filename: result.filename,
                  url: imageDownloadUrl(settings.backendUrl, result.url),
                  enhanced: true,
                },
              }
            : m
        ),
      });

      setEnhanceStates((prev) => ({ ...prev, [key]: { status: "done", steps } }));
      setTimeout(() => {
        setEnhanceStates((prev) => {
          const { [key]: _drop, ...rest } = prev;
          return rest;
        });
      }, 1400);
    } catch (e) {
      console.error("[imagegen] enhance failed:", e);
      setEnhanceStates((prev) => ({ ...prev, [key]: { status: "error", error: e.message } }));
    } finally {
      clearInterval(stepTimer);
    }
  };

  // Prompt-guided edit (img2img via /tools/image/edit). Same
  // per-message-state shape as handleEnhanceImage above -- mutates the
  // imageArtifact on the existing assistant message in place rather
  // than starting a new chat turn, using editStates instead of the
  // shared isGenerating/genState row since this only affects one card.
  const handleEditImage = async (messageIndex, { prompt, strength, useControlnet }) => {
    const session = current;
    if (!session) return;
    const msg = session.messages[messageIndex];
    if (!msg?.imageArtifact?.filename) return;
    if (!prompt?.trim()) {
      showToast("Describe the edit you want first");
      return;
    }

    const key = `${session.id}-${messageIndex}`;
    setEditStates((prev) => ({ ...prev, [key]: { status: "running" } }));

    try {
      const result = await editImage({
        backendUrl: settings.backendUrl,
        filename: msg.imageArtifact.filename,
        prompt,
        style: msg.imageArtifact.style || settings.defaultImageStyle || "realistic",
        strength,
        useControlnet,
      });

      updateSession(session.id, {
        messages: session.messages.map((m, i) =>
          i === messageIndex
            ? {
                ...m,
                imageArtifact: {
                  ...m.imageArtifact,
                  filename: result.filename,
                  url: imageDownloadUrl(settings.backendUrl, result.url),
                  prompt: result.prompt,
                  edited: true,
                },
              }
            : m
        ),
      });

      setEditStates((prev) => ({ ...prev, [key]: { status: "done" } }));
      setTimeout(() => {
        setEditStates((prev) => {
          const { [key]: _drop, ...rest } = prev;
          return rest;
        });
      }, 1400);
    } catch (e) {
      console.error("[imagegen] edit failed:", e);
      setEditStates((prev) => ({ ...prev, [key]: { status: "error", error: e.message } }));
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const isEmpty = !current || current.messages.length === 0;

  return (
    <div id="shell">
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        currentId={currentId}
        onNewChat={handleNewChat}
        onSelect={setCurrentId}
        onDelete={handleDelete}
        onRename={(id, title) => updateSession(id, { title })}
        onOpenSettings={() => setShowSettings(true)}
        onToggle={setSidebarOpen}
      />
      {!sidebarOpen && window.innerWidth <= 640 && (
        <div id="sidebar-backdrop" className="visible" onClick={() => setSidebarOpen(true)} />
      )}

      <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
        ☰
      </button>

      <div id="main">
        {isEmpty ? (
          <div className="empty-state">
            <h1 className="quote-heading">{quote}</h1>
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={handleSend}
              onStop={handleStop}
              isGenerating={isGenerating}
              attachments={attachments}
              setAttachments={setAttachments}
              backendUrl={settings.backendUrl}
              knowledgeMode={knowledgeMode}
             onToggleKnowledge={() => setKnowledgeMode((v) => !v)}
             activeCollection={activeCollection}
             onOpenKnowledgeModal={() => setShowKnowledgeModal(true)}
             searchMode={searchMode}
             onToggleSearch={() => setSearchMode((v) => !v)}
              smartMode={smartMode}
              onToggleSmartMode={() => setSmartMode((v) => !v)}
              onSmartSend={handleSmartSend}
              smartRouting={smartRouting}
             onGenerateFile={handleGenerateFile}
             onGenerateImage={handleGenerateImage}
             imageMode={imageMode}
             onToggleImageMode={() => setImageMode((v) => !v)}
             imageInputMode={settings.imageInputMode}
             onUploadImage={handleUploadImage}
             onOpenCodePanel={openCodePanel}
              svgMode={svgMode}
              onToggleSvgMode={() => setSvgMode((v) => !v)}
              onGenerateSvg={handleGenerateSvg}
              chartMode={chartMode}
              onToggleChartMode={() => setChartMode((v) => !v)}
              onGenerateChart={handleGenerateChart}
              onGenerateConvert={handleGenerateConvert}
              diagramMode={diagramMode}
              onToggleDiagramMode={() => setDiagramMode((v) => !v)}
              onGenerateDiagram={handleGenerateDiagram}
              browserMode={browserMode}
              onToggleBrowserMode={() => setBrowserMode((v) => !v)}
              onGenerateBrowserTask={handleGenerateBrowserTask}
              teacherMode={teacherMode}
              onToggleTeacherMode={handleToggleTeacherMode}
              teacherLesson={teacherLesson}
              onSetTeacherLesson={handleSetTeacherLesson}
              teacherLevel={teacherLevel}
              onSetTeacherLevel={handleSetTeacherLevel}
              teacherStyle={teacherStyle}
              onSetTeacherStyle={handleSetTeacherStyle}
              onGenerateTeacherTurn={handleGenerateTeacherTurn}
             centered
            />
          </div>
        ) : (
          <>
            <div id="chat-scroll" ref={scrollRef}>
              <div className="chat-inner">
                {current.messages.map((m, i) => (
                  <Message
                    key={i}
                    role={m.role}
                    content={m.content}
                    attachments={m.attachments}
                    backendUrl={settings.backendUrl}
                    ttsVoice={settings.ttsVoice}
                    onEdit={m.role === "user" && !isGenerating ? () => handleEditMessage(i) : null}
                    onRegenerate={
                      m.role === "assistant" && !isGenerating ? () => handleRegenerate(i) : null
                    }
                    citations={m.citations}
                    media={m.media}
                    dataArtifact={m.dataArtifact}
                    fileArtifact={m.fileArtifact}
                    convertArtifact={m.convertArtifact}
                    imageArtifact={m.imageArtifact}
                    svgArtifact={m.svgArtifact}
                    chartArtifact={m.chartArtifact}
                    diagramArtifact={m.diagramArtifact}
                    browserArtifact={m.browserArtifact}
                    teacherArtifact={m.teacherArtifact}
                    onQuizAnswered={
                      m.teacherArtifact?.quiz && i === current.messages.length - 1 && !isGenerating
                        ? handleContinueTeacherQuiz
                        : null
                    }
                    onContinueStory={
                      m.teacherArtifact?.lesson === "story" && m.teacherArtifact?.story?.text && i === current.messages.length - 1 && !isGenerating
                        ? handleContinueTeacherStory
                        : null
                    }
                    onEnhanceImage={m.imageArtifact && !m.imageArtifact.error ? (opts) => handleEnhanceImage(i, opts) : null}
                    enhanceState={enhanceStates[`${current.id}-${i}`]}
                    onEditImage={m.imageArtifact && !m.imageArtifact.error ? (opts) => handleEditImage(i, opts) : null}
                    editState={editStates[`${current.id}-${i}`]}
                  />
                ))}
                {isGenerating && genState === "generating-image" && <GeneratingImageSkeleton />}
                {isGenerating && genState === "generating-svg" && <GeneratingSvgSkeleton label="Generating SVG…" />}
                {isGenerating && genState === "generating-chart" && <GeneratingChartSkeleton label="Rendering chart…" />}
                {isGenerating && genState === "generating-diagram" && <GeneratingDiagramSkeleton label="Rendering diagram…" />}
                {isGenerating && genState === "running-browser-task" && <GeneratingBrowserSkeleton />}
                {isGenerating && genState === "teaching" && <GeneratingTeacherSkeleton />}
                {isGenerating && genState !== "generating-image" && genState !== "generating-svg" && genState !== "generating-chart" && genState !== "generating-diagram" && genState !== "running-browser-task" && genState !== "teaching" && (
                  <div className="state-row">
                    {genState === "writing" ? (
                      <>
                        <div className="wave-bars">
                          <span /><span /><span /><span /><span />
                        </div>
                        <span className="state-label shimmer-text">Writing…</span>
                      </>
                    ) : (
                      <>
                        <div className="pulse-orb" />
                        <span className="state-label shimmer-text">{GEN_STATE_LABELS[genState] || GEN_STATE_LABELS.thinking}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={handleSend}
              onStop={handleStop}
              isGenerating={isGenerating}
              attachments={attachments}
              setAttachments={setAttachments}
              compareMode={compareMode}
              onToggleCompare={() => setCompareMode((v) => !v)}
              models={allModels}
              compareModelA={compareModelA}
              compareModelB={compareModelB}
              onCompareModelAChange={setCompareModelA}
              onCompareModelBChange={setCompareModelB}
              backendUrl={settings.backendUrl}
              knowledgeMode={knowledgeMode}
              onToggleKnowledge={() => setKnowledgeMode((v) => !v)}
              activeCollection={activeCollection}
              onOpenKnowledgeModal={() => setShowKnowledgeModal(true)}
              searchMode={searchMode}
              onToggleSearch={() => setSearchMode((v) => !v)}
              smartMode={smartMode}
              onToggleSmartMode={() => setSmartMode((v) => !v)}
              onSmartSend={handleSmartSend}
              smartRouting={smartRouting}
              onGenerateFile={handleGenerateFile}
              onGenerateImage={handleGenerateImage}
              imageMode={imageMode}
              onToggleImageMode={() => setImageMode((v) => !v)}
              imageInputMode={settings.imageInputMode}
              onUploadImage={handleUploadImage}
              onOpenCodePanel={openCodePanel}
              svgMode={svgMode}
              onToggleSvgMode={() => setSvgMode((v) => !v)}
              onGenerateSvg={handleGenerateSvg}
              chartMode={chartMode}
              onToggleChartMode={() => setChartMode((v) => !v)}
              onGenerateChart={handleGenerateChart}
              onGenerateConvert={handleGenerateConvert}
              diagramMode={diagramMode}
              onToggleDiagramMode={() => setDiagramMode((v) => !v)}
              onGenerateDiagram={handleGenerateDiagram}
              browserMode={browserMode}
              onToggleBrowserMode={() => setBrowserMode((v) => !v)}
              onGenerateBrowserTask={handleGenerateBrowserTask}
              teacherMode={teacherMode}
              onToggleTeacherMode={handleToggleTeacherMode}
              teacherLesson={teacherLesson}
              onSetTeacherLesson={handleSetTeacherLesson}
              teacherLevel={teacherLevel}
              onSetTeacherLevel={handleSetTeacherLevel}
              teacherStyle={teacherStyle}
              onSetTeacherStyle={handleSetTeacherStyle}
              onGenerateTeacherTurn={handleGenerateTeacherTurn}
            />
          </>
        )}
      </div>

      <div className="panel-resize-handle" />
      <ArtifactPanel open={artifactOpen} onClose={() => setArtifactOpen(false)} content={artifactContent} />

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
          onClose={() => setShowSettings(false)}
          theme={theme}
          onThemeChange={setTheme}
          onApplyPersonality={(p) => {
            if (!current) return;
            updateSession(current.id, { systemPrompt: p.systemPrompt });
            if (p.preferredModel) setSettings((prev) => ({ ...prev, model: p.preferredModel }));
          }}
        />
      )}

      {showKnowledgeModal && (
        <KnowledgeModal
          backendUrl={settings.backendUrl}
          activeCollection={activeCollection}
          onSelectCollection={setActiveCollection}
          onClose={() => setShowKnowledgeModal(false)}
        />
      )}

      {compareOpen && (
        <CompareSplitView
          prompt={comparePrompt}
          modelA={compareModelA}
          modelB={compareModelB}
          textA={compareText.a}
          textB={compareText.b}
          loading={compareLoading}
          onClose={() => setCompareOpen(false)}
        />
      )}

      <div id="toast" className={toast ? "visible" : ""}>{toast}</div>
    </div>
  );
}