import { useRef } from "react";
import { TOOLS } from "../lib/extensions";
import DocumentButton from "./tools/DocumentButton.jsx";
import DataButton from "./tools/DataButton.jsx";
import VisionButton from "./tools/VisionButton.jsx";
import GenerateButton from "./tools/GenerateCard.jsx";
import ImageButton, { ImageUploadButton } from "./tools/ImagePanel.jsx";
import SvgToggle from "./tools/SvgToggle.jsx";
import ChartToggle from "./tools/ChartToggle.jsx";
import ConvertToggle from "./tools/ConvertToggle.jsx";
import DiagramToggle from "./tools/DiagramToggle.jsx";
import SearchToggle from "./tools/SearchToggle.jsx";
import BrowserToggle from "./tools/BrowserToggle.jsx";
import TeacherToggle from "./tools/TeacherToggle.jsx";
import { transcribeAudio } from "../lib/tools/voice";
import { useState } from "react";

const PASTE_LINE_THRESHOLD = 100;
const PASTE_CHAR_THRESHOLD = 4000;

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  attachments,
  setAttachments,
  centered,
  compareMode,
  onToggleCompare,
  models = [],
  compareModelA,
  compareModelB,
  onCompareModelAChange,
  onCompareModelBChange,
  backendUrl,
  knowledgeMode,
  onToggleKnowledge,
  activeCollection,
  onOpenKnowledgeModal,
  searchMode,
  onToggleSearch,
  smartMode,
  onToggleSmartMode,
  onSmartSend,
  smartRouting,
  onGenerateFile,
  onGenerateImage,
  imageMode,
  onToggleImageMode,
  imageInputMode,
  onUploadImage,
  onOpenCodePanel,
  svgMode,
  onToggleSvgMode,
  onGenerateSvg,
  chartMode,
  onToggleChartMode,
  onGenerateChart,
  onGenerateConvert,
  diagramMode,
  onToggleDiagramMode,
  onGenerateDiagram,
  browserMode,
  onToggleBrowserMode,
  onGenerateBrowserTask,
  teacherMode,
  onToggleTeacherMode,
  teacherLesson,
  onSetTeacherLesson,
  teacherLevel,
  onSetTeacherLevel,
  teacherStyle,
  onSetTeacherStyle,
  onGenerateTeacherTurn,
}) {
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const autoGrow = (el) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };

  const addAttachment = (att) => setAttachments((prev) => [...prev, att]);
  const removeAttachment = (id) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const handlePaste = (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () =>
          addAttachment({ id: crypto.randomUUID(), name: file.name || "pasted-image.png", type: "image", data: reader.result });
        reader.readAsDataURL(file);
        return;
      }
    }
    const text = e.clipboardData?.getData("text/plain") || "";
    const lines = text.split("\n").length;
    if (lines > PASTE_LINE_THRESHOLD || text.length > PASTE_CHAR_THRESHOLD) {
      e.preventDefault();
      // Must match the { type: "document", text } shape App.jsx's
      // buildDocContext() actually reads. This used to be
      // { type: "text", data } — the chip rendered fine but its content
      // never reached the model, so questions about pasted text got
      // answered blind.
      addAttachment({
        id: crypto.randomUUID(),
        name: `Pasted text (${lines} lines)`,
        type: "document",
        text,
      });
    }
  };

  const handleFiles = (files) => {
    files.forEach((file) => {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = () =>
        addAttachment(
          isImage
            ? { id: crypto.randomUUID(), name: file.name, type: "image", data: reader.result }
            // Same fix: plain-text file attachments (.txt/.md/.js/etc via
            // the paperclip) need { type: "document", text } or
            // buildDocContext never sees their content either.
            : { id: crypto.randomUUID(), name: file.name, type: "document", text: reader.result }
        );
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  // Phase 11 -- mic button. Records with MediaRecorder, sends the blob
  // to the backend for faster-whisper transcription on stop, then
  // appends the text into the draft. Uses a functional update
  // (onChange === setDraft in App.jsx) so it never clobbers text typed
  // while the recording was in progress.
  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!backendUrl) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setTranscribing(true);
        try {
          const { text } = await transcribeAudio({ backendUrl, blob });
          if (text) onChange((prev) => (prev ? `${prev} ${text}` : text));
        } catch (err) {
          console.error("[voice] transcription failed", err);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error("[voice] mic access failed", err);
    }
  };

  const send = () => {
    if (isGenerating) return onStop();
    // Smart Mode: skip every manual mode branch below and let
    // handleSmartSend() (App.jsx) classify the message and dispatch
    // to the right tool on its own.
    if (smartMode && onSmartSend) {
      if (!value.trim() && attachments.length === 0) return;
      onSmartSend();
      return;
    }
    // Image mode: Enter/send always generates an image from the typed
    // prompt instead of sending a normal chat message, so turning the
    // toggle on once is enough for every image after that — no popover,
    // no extra click on Generate each time.
    if (imageMode && onGenerateImage) {
      if (!value.trim()) return;
      onGenerateImage();
      return;
    }
    // SVG mode: same shape as image mode above — while armed, Enter/
    // send generates an SVG from the typed prompt instead of sending
    // a normal chat message.
    if (svgMode && onGenerateSvg) {
      if (!value.trim()) return;
      onGenerateSvg();
      return;
    }
    // Chart mode: same shape as image/SVG mode above -- while armed,
    // Enter/send generates a chart from the typed prompt instead of
    // a normal chat message.
    if (chartMode && onGenerateChart) {
      if (!value.trim()) return;
      onGenerateChart();
      return;
    }
    // Convert mode: armed automatically the moment a "convert-file"
    // attachment exists (ConvertToggle.jsx attaches raw files, not
    // extracted text). While one is present, Enter/send posts the
    // file(s) + typed prompt to /tools/convert instead of a normal
    // chat message.
    if (onGenerateConvert && attachments.some((a) => a.type === "convert-file")) {
      if (!value.trim()) return;
      onGenerateConvert();
      return;
    }
    // Diagram mode: same shape as chart mode above -- while armed,
    // Enter/send generates a diagram from the typed prompt instead
    // of a normal chat message.
    // Browser mode: same shape as diagram mode above -- while armed,
    // Enter/send runs a browser automation task from the typed prompt
    // instead of a normal chat message.
    if (browserMode && onGenerateBrowserTask) {
      if (!value.trim()) return;
      onGenerateBrowserTask();
      return;
    }
    if (teacherMode && onGenerateTeacherTurn) {
      if (!value.trim()) return;
      onGenerateTeacherTurn();
      return;
    }
    if (diagramMode && onGenerateDiagram) {
      if (!value.trim()) return;
      onGenerateDiagram();
      return;
    }
    if (!value.trim() && attachments.length === 0) return;
    onSend();
  };

  return (
    <div id="input-wrap" className={centered ? "centered-mode" : ""}>
      {compareMode && (
        <div className="system-prompt-bar">
          <span>Compare:</span>
          <select value={compareModelA} onChange={(e) => onCompareModelAChange(e.target.value)}>
            <option value="">Model A…</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={compareModelB} onChange={(e) => onCompareModelBChange(e.target.value)}>
            <option value="">Model B…</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a) => (
              <div className={`attach-chip${a.type === "data-error" ? " chip-error" : ""}`} key={a.id}>
                <div className="chip-preview">
                  {a.type === "image" ? <img src={a.data} alt="" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>}
                </div>
                <div className="chip-footer">
                  <span className="attach-chip-name" title={a.name}>{a.name}</span>
                  <span className="chip-badge">{a.type}</span>
                </div>
                <button className="attach-chip-remove" onClick={() => removeAttachment(a.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          rows={1}
          placeholder={smartMode ? "Type anything — Smart Mode will pick the right tool…" : imageMode ? (imageInputMode === "upload" ? "Click the upload button to add a photo…" : "Describe the image to generate…") : svgMode ? "Describe the SVG to generate…" : chartMode ? "Describe the chart to generate…" : diagramMode ? "Describe the diagram to generate…" : "Message your local AI…"}
          value={value}
          onPaste={handlePaste}
          onChange={(e) => {
            onChange(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />

        <div className="composer-toolbar">
          <button className="tool-btn" title="Attach file" onClick={() => fileRef.current?.click()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {onToggleCompare && (
            <button
              className={`tool-btn compare-toggle ${compareMode ? "active" : ""}`}
              title="Compare mode"
              onClick={onToggleCompare}
            >
              ⇄
            </button>
          )}
          {onToggleKnowledge && (
            <button
              className={`tool-btn compare-toggle ${knowledgeMode ? "active" : ""}`}
              title={activeCollection ? `Knowledge: ${activeCollection}` : "Knowledge mode"}
              onClick={onToggleKnowledge}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {knowledgeMode && activeCollection && (
            <span className="knowledge-active-pill">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: "-1px", marginRight: 4 }}>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {activeCollection}
            </span>
          )}
          {onOpenKnowledgeModal && (
            <button className="tool-btn" title="Manage knowledge collections" onClick={onOpenKnowledgeModal}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {onOpenCodePanel && (
            <button className="tool-btn" title="Coding agent (sandboxed file tree + run)" onClick={onOpenCodePanel}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M8 9l-4 4 4 4M16 9l4 4-4 4M14 5l-4 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {backendUrl && onGenerateSvg && (
            <SvgToggle active={svgMode} onToggle={onToggleSvgMode} />
          )}
          {onGenerateChart && (
            <ChartToggle active={chartMode} onToggle={onToggleChartMode} />
          )}
          {backendUrl && onGenerateConvert && (
            <ConvertToggle
              active={attachments.some((a) => a.type === "convert-file")}
              onAttachFiles={(atts) => setAttachments((prev) => [...prev, ...atts])}
            />
          )}
          {onGenerateBrowserTask && (
            <BrowserToggle active={browserMode} onToggle={onToggleBrowserMode} />
          )}
          {onGenerateTeacherTurn && (
            <TeacherToggle
              active={teacherMode}
              onToggle={onToggleTeacherMode}
              lesson={teacherLesson}
              onSetLesson={onSetTeacherLesson}
              level={teacherLevel}
              onSetLevel={onSetTeacherLevel}
              style={teacherStyle}
              onSetStyle={onSetTeacherStyle}
            />
          )}
          {onGenerateDiagram && (
            <DiagramToggle active={diagramMode} onToggle={onToggleDiagramMode} />
          )}
          {backendUrl && (
            <DocumentButton
              backendUrl={backendUrl}
              onAttach={(att) => setAttachments((prev) => [...prev, att])}
            />
          )}
          {backendUrl && (
            <DataButton
              backendUrl={backendUrl}
              onAttach={(att) => setAttachments((prev) => [...prev, att])}
            />
          )}
          {backendUrl && (
            <VisionButton
              backendUrl={backendUrl}
              onAttach={(att) => setAttachments((prev) => [...prev, att])}
            />
          )}
          {backendUrl && (
            <button
              className={`tool-btn ${recording ? "active" : ""}`}
              title={recording ? "Stop recording" : transcribing ? "Transcribing…" : "Record voice message"}
              disabled={transcribing}
              onClick={toggleRecording}
            >
              {transcribing ? "…" : recording ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </button>
          )}
          {backendUrl && onGenerateFile && (
            <GenerateButton draft={value} attachments={attachments} onGenerate={onGenerateFile} />
          )}
          {backendUrl && onGenerateImage && (
            <ImageButton active={imageMode} onToggle={onToggleImageMode} />
          )}
          {backendUrl && imageMode && imageInputMode === "upload" && onUploadImage && (
            <ImageUploadButton onUpload={onUploadImage} />
          )}
          {onToggleSmartMode && (
            <button
              className={`tool-btn smart-mode-toggle ${smartMode ? "active" : ""}`}
              title={smartMode ? "Smart Mode: on — auto-detects what to do" : "Smart Mode: off — click to let AI pick the right tool automatically"}
              onClick={onToggleSmartMode}
            >
              {smartRouting ? (
                <span className="pulse-orb" style={{ width: 11, height: 11 }} />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2.5l1.8 5.4 5.4 1.8-5.4 1.8L12 17l-1.8-5.5-5.4-1.8 5.4-1.8L12 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill={smartMode ? "currentColor" : "none"} />
                  <path d="M19 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill={smartMode ? "currentColor" : "none"} />
                </svg>
              )}
            </button>
          )}
          {onToggleSearch && (
            <SearchToggle active={searchMode} onClick={onToggleSearch} />
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              handleFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />

          {/* Phase-2 extension slot — TOOLS is empty until tools register themselves */}
          {TOOLS.map((t) => (
            <button key={t.id} className="tool-btn" title={t.label} onClick={() => t.onClick?.({ addAttachment })}>
              {t.icon || t.label[0]}
            </button>
          ))}

          <div className="composer-spacer" />

          <button id="send-btn" onClick={send} disabled={!isGenerating && !value.trim() && attachments.length === 0}>
            {isGenerating ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {centered && (
        <p className="input-hint">
          {imageMode
            ? (imageInputMode === "upload" ? "Click the photo icon to upload and enhance" : "Enter to generate an image · Shift+Enter for a new line")
            : svgMode
            ? "Enter to generate an SVG · Shift+Enter for a new line"
            : chartMode
            ? "Enter to generate a chart · Shift+Enter for a new line"
            : browserMode
            ? "Enter to run a browser task · Shift+Enter for a new line"
            : diagramMode
            ? "Enter to generate a diagram · Shift+Enter for a new line"
            : "Enter to send · Shift+Enter for a new line"}
        </p>
      )}
    </div>
  );
}
