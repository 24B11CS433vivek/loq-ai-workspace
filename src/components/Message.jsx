import { useMemo, useRef, useState } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import SearchResultsCard from "./SearchResultsCard";
import { DataArtifact } from "./tools/DataButton.jsx";
import { GenerateCard } from "./tools/GenerateCard.jsx";
import { ConvertCard } from "./tools/ConvertCard.jsx";
import { ImageCard } from "./tools/ImagePanel.jsx";
import SvgCard from "./tools/SvgCard.jsx";
import ChartCard from "./tools/ChartCard.jsx";
import DiagramCard from "./tools/DiagramCard.jsx";
import BrowserCard from "./tools/BrowserCard.jsx";
import TeacherCard from "./tools/TeacherCard.jsx";
import { ArtifactCard } from "./tools/ArtifactCard.jsx";
import { detectHtmlArtifact } from "../lib/tools/htmlArtifact";
import { speakText, audioDownloadUrl } from "../lib/tools/voice";

const COPY_SVG =
  '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3.5" width="7" height="8.5" rx="1.2" stroke="currentColor" stroke-width="1.2"></rect><path d="M4.5 3.5V2.5A1.2 1.2 0 0 1 5.7 1.3H11A1.2 1.2 0 0 1 12.2 2.5V9A1.2 1.2 0 0 1 11 10.2H10" stroke="currentColor" stroke-width="1.2"></path></svg>';
const CHECK_SVG =
  '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.3l3 3 6-6.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

// Claude-style fenced code blocks: header bar with language + a copy
// button, instead of marked's bare <pre><code>.
const renderer = new marked.Renderer();
renderer.code = (code, infostring) => {
  const language = (infostring || "").trim().split(/\s+/)[0] || "text";
  let escaped;
  try {
    escaped = hljs.getLanguage(language)
      ? hljs.highlight(String(code), { language }).value
      : hljs.highlightAuto(String(code)).value;
  } catch {
    escaped = String(code)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  return (
    `<div class="code-block">` +
    `<div class="code-block-header">` +
    `<span class="code-lang">${language}</span>` +
    `<button type="button" class="code-copy-btn" data-code-copy>` +
    `<span class="copy-icon">${COPY_SVG}</span>` +
    `<span class="copy-label">Copy</span>` +
    `</button>` +
    `</div>` +
    `<pre><code>${escaped}</code></pre>` +
    `</div>`
  );
};

marked.setOptions({ breaks: true, gfm: true, renderer });

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M9.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L5.5 10.9l-2.8.7.7-2.8 6-6z"
          stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="3.5" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.5 3.5V2.5A1.2 1.2 0 0 1 5.7 1.3H11A1.2 1.2 0 0 1 12.2 2.5V9A1.2 1.2 0 0 1 11 10.2H10"
          stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.3l3 3 6-6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RegenerateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M12.5 3.5A5.5 5.5 0 1 0 13 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M13 2v4h-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FullscreenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M1.5 5V2.5a1 1 0 0 1 1-1H5M9 1.5h2.5a1 1 0 0 1 1 1V5M12.5 9v2.5a1 1 0 0 1-1 1H9M5 12.5H2.5a1 1 0 0 1-1-1V9"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
    <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

// Phase 11 -- speaker icons for the read-aloud button.
const SpeakerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PauseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" />
    <rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" />
  </svg>
);

export default function Message({ role, content, attachments, onEdit, onRegenerate, citations, media, dataArtifact, fileArtifact, convertArtifact, imageArtifact, svgArtifact, chartArtifact, diagramArtifact, browserArtifact, teacherArtifact, onQuizAnswered, onContinueStory, onEnhanceImage, enhanceState, onEditImage, editState, backendUrl, ttsVoice }) {
  const [copied, setCopied] = useState(false);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const html = useMemo(() => marked.parse(content || ""), [content]);
  // Phase 13A -- standalone HTML/CSS/JS deliverable detected in this
  // message's raw markdown, if any (see lib/tools/htmlArtifact.js).
  const htmlArtifact = useMemo(
    () => (role === "assistant" ? detectHtmlArtifact(content) : null),
    [content, role]
  );

  // Phase 11 -- read-aloud. Lazily fetches TTS audio from the backend on
  // first click, then just plays/pauses that same cached <audio> element
  // on subsequent clicks instead of re-synthesizing every time.
  const [speechState, setSpeechState] = useState("idle"); // idle | loading | playing | paused
  const audioRef = useRef(null);

  const toggleSpeech = async () => {
    if (audioRef.current && speechState === "playing") {
      audioRef.current.pause();
      return;
    }
    if (audioRef.current) {
      audioRef.current.play();
      return;
    }
    setSpeechState("loading");
    try {
      // ttsVoice comes from Settings; "piper" (the sentinel for "no
      // preference selected") is left off so the backend falls back to
      // its own default -- everything else (a built-in language voice or
      // a clone:<id>) is passed straight through. Telugu text is
      // auto-detected server-side regardless of what's selected here.
      const { url, note } = await speakText({
        backendUrl,
        text: content,
        voice: ttsVoice && ttsVoice !== "piper" ? ttsVoice : undefined,
      });
      if (note) console.info("[voice]", note);
      const audio = new Audio(audioDownloadUrl(backendUrl, url));
      audio.onplay = () => setSpeechState("playing");
      audio.onpause = () => setSpeechState("paused");
      audio.onended = () => setSpeechState("paused");
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error("[voice] speak failed", err);
      setSpeechState("idle");
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Delegated click handler for the per-code-block Copy buttons injected
  // via dangerouslySetInnerHTML — React can't attach handlers directly
  // to that raw HTML, so we catch the bubbled click here instead.
  const handleContentClick = (e) => {
    const btn = e.target.closest("[data-code-copy]");
    if (!btn) return;
    const codeEl = btn.closest(".code-block")?.querySelector("pre code");
    if (!codeEl) return;
    navigator.clipboard.writeText(codeEl.textContent || "");
    const label = btn.querySelector(".copy-label");
    const icon = btn.querySelector(".copy-icon");
    btn.classList.add("copied");
    if (label) label.textContent = "Copied";
    if (icon) icon.innerHTML = CHECK_SVG;
    setTimeout(() => {
      btn.classList.remove("copied");
      if (label) label.textContent = "Copy";
      if (icon) icon.innerHTML = COPY_SVG;
    }, 1200);
  };

  return (
    <>
    <div className={`msg ${role}`}>
      <div className="msg-avatar">{role === "user" ? "U" : "AI"}</div>
      <div className="msg-body">
        {/* Bubble wraps ONLY the message content — actions live outside
            it so the edit/copy/regenerate icons never sit boxed-in
            with the text. */}
        <div className="bubble">
          {attachments?.length > 0 && (
            <div className="attach-chips" style={{ padding: "0 0 8px" }}>
              {attachments.map((a) => (
                <div className="attach-chip" key={a.id}>
                  <div className="chip-preview">
                    {a.type === "image" ? <img src={a.data} alt="" /> : <span>📎</span>}
                  </div>
                  <div className="chip-footer">
                    <span className="attach-chip-name">{a.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="msg-content" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: html }} />
          {role === "assistant" && dataArtifact && (
            <div className="inline-data-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Data analysis</span>
                <button
                  className="msg-action-btn"
                  title="View full screen"
                  onClick={() => setArtifactFullscreen(true)}
                >
                  <FullscreenIcon />
                </button>
              </div>
              <DataArtifact
                filename={dataArtifact.filename}
                operation={dataArtifact.operation}
                result={dataArtifact.result}
                imageBase64={dataArtifact.imageBase64}
                error={dataArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && fileArtifact && (
            <div className="inline-data-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Generated file</span>
              </div>
              <GenerateCard
                kind={fileArtifact.kind}
                filename={fileArtifact.filename}
                downloadUrl={fileArtifact.downloadUrl}
                title={fileArtifact.title}
                meta={fileArtifact.meta}
                error={fileArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && convertArtifact && (
            <div className="inline-data-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Converted file</span>
              </div>
              <ConvertCard
                results={convertArtifact.results}
                error={convertArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && imageArtifact && (
            <div className="inline-data-artifact inline-image-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Generated image</span>
              </div>
              <ImageCard
                filename={imageArtifact.filename}
                url={imageArtifact.url}
                prompt={imageArtifact.prompt}
                style={imageArtifact.style}
                error={imageArtifact.error}
                enhanced={imageArtifact.enhanced}
                onEnhance={onEnhanceImage}
                enhanceState={enhanceState}
                onEditImage={onEditImage}
                editState={editState}
              />
            </div>
          )}
          {role === "assistant" && svgArtifact && (
            <div className="inline-data-artifact inline-image-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Generated SVG</span>
              </div>
              <SvgCard
                svgCode={svgArtifact.svg_code}
                prompt={svgArtifact.prompt}
                style={svgArtifact.style}
                model={svgArtifact.model}
                plan={svgArtifact.plan}
                error={svgArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && chartArtifact && (
            <div className="inline-data-artifact inline-image-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Generated Chart</span>
              </div>
              <ChartCard
                type={chartArtifact.type}
                labels={chartArtifact.labels}
                values={chartArtifact.values}
                datasets={chartArtifact.datasets}
                prompt={chartArtifact.prompt}
                error={chartArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && browserArtifact && (
            <BrowserCard
              steps={browserArtifact.steps}
              summary={browserArtifact.summary}
              error={browserArtifact.error}
            />
          )}
          {role === "assistant" && teacherArtifact && (
            <TeacherCard
              lesson={teacherArtifact.lesson}
              phase={teacherArtifact.phase}
              corrected={teacherArtifact.corrected}
              correctionNote={teacherArtifact.correctionNote}
              category={teacherArtifact.category}
              severity={teacherArtifact.severity}
              score={teacherArtifact.score}
              nextFocus={teacherArtifact.nextFocus}
              avgScore={teacherArtifact.avgScore}
              quiz={teacherArtifact.quiz}
              story={teacherArtifact.story}
              weakSpots={teacherArtifact.weakSpots}
              error={teacherArtifact.error}
              onQuizAnswered={onQuizAnswered}
              onContinueStory={onContinueStory}
            />
          )}
          {role === "assistant" && diagramArtifact && (
            <div className="inline-data-artifact inline-image-artifact">
              <div className="inline-data-artifact-header">
                <span className="inline-data-artifact-label">Generated Diagram</span>
              </div>
              <DiagramCard
                code={diagramArtifact.code}
                prompt={diagramArtifact.prompt}
                error={diagramArtifact.error}
              />
            </div>
          )}
          {role === "assistant" && htmlArtifact && (
            <ArtifactCard title={htmlArtifact.title} html={htmlArtifact.html} />
          )}
          {role === "assistant" && (citations?.length > 0 || Object.values(media || {}).some((v) => Array.isArray(v) && v.length > 0)) && (
            <SearchResultsCard
              query={media?.query}
              confidence={media?.confidence}
              summary={media?.summary}
              citations={citations}
              media={media}
            />
          )}
        </div>

        <div className="msg-actions">
          {role === "user" && onEdit && (
            <button className="msg-action-btn" onClick={onEdit} title="Edit message">
              <EditIcon />
            </button>
          )}
          {role === "assistant" && content && (
            <>
              <button className={`msg-action-btn ${copied ? "copied" : ""}`} onClick={copy} title="Copy">
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
              {onRegenerate && (
                <button className="msg-action-btn" onClick={onRegenerate} title="Regenerate response">
                  <RegenerateIcon />
                </button>
              )}
              {backendUrl && (
                <button
                  className="msg-action-btn"
                  onClick={toggleSpeech}
                  title={speechState === "playing" ? "Pause" : "Read aloud"}
                  disabled={speechState === "loading"}
                >
                  {speechState === "loading" ? "…" : speechState === "playing" ? <PauseIcon /> : <SpeakerIcon />}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {artifactFullscreen && dataArtifact && (
      <div className="data-artifact-fullscreen-overlay" onClick={() => setArtifactFullscreen(false)}>
        <div className="data-artifact-fullscreen-panel" onClick={(e) => e.stopPropagation()}>
          <div className="data-artifact-fullscreen-toolbar">
            <span>{dataArtifact.filename}</span>
            <button className="msg-action-btn" title="Close" onClick={() => setArtifactFullscreen(false)}>
              <CloseIcon />
            </button>
          </div>
          <div className="data-artifact-fullscreen-body">
            <DataArtifact
              filename={dataArtifact.filename}
              operation={dataArtifact.operation}
              result={dataArtifact.result}
              imageBase64={dataArtifact.imageBase64}
              error={dataArtifact.error}
            />
          </div>
        </div>
      </div>
    )}
    </>
  );
}