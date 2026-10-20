# LOQ AI Workspace

> A fully local, private-first AI assistant with 22 built-in tools — built by **Vivek Talagaturi** ([@24B11CS433vivek](https://github.com/24B11CS433vivek)).

No cloud. No API keys. Runs entirely on your own machine using a local [Ollama](https://ollama.com) model and a local FastAPI backend. Only **Web Search** and **Browser Agent** ever touch the live internet, and only when you trigger them.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Tool Reference](#tool-reference)
- [Configuration & Settings](#configuration--settings)
- [Project Structure](#project-structure)
- [Backend API](#backend-api)
- [Troubleshooting](#troubleshooting)
- [Author](#author)

---

## Features

| # | Tool / Mode | What it does |
|---|---|---|
| 1 | **Normal Chat** | Everyday conversation, writing, code help, math — streamed token-by-token from a local Ollama model |
| 2 | **Smart Mode** | Toggle in the composer — auto-classifies each message (image / svg / chart / diagram / browser / search / chat) and fires the right tool automatically |
| 3 | **Creative Studio (Image)** | Generate images from a text prompt (illustrative / realistic / cyberrealistic styles via ComfyUI) or upload and enhance a photo (face fix, upscale, background removal, color grade) |
| 4 | **SVG Studio** | Generate clean vector SVG icons, logos, badges and illustrations; optional Think pass plans a design brief first |
| 5 | **Chart Builder** | Turn a plain-language request or an uploaded CSV/spreadsheet into a rendered bar / line / pie chart, downloadable as PNG or CSV |
| 6 | **Diagram Studio** | Flowcharts, sequence diagrams, architecture diagrams, and mind maps from a description (Mermaid-powered) |
| 7 | **Web Search** | Live web lookups via a local SearXNG instance — results shown as categorised source cards with full page text extraction |
| 8 | **Browser Agent** | Autonomous Playwright browser session: navigate, click, fill forms, complete multi-step live web tasks |
| 9 | **Knowledge / RAG** | Create named knowledge collections, upload files, query strictly against that material for cited answers (ChromaDB + nomic-embed-text) |
| 10 | **Document Upload in Chat** | Attach PDFs, DOCX, PPTX, spreadsheets directly to a conversation; content is extracted and injected as context |
| 11 | **Vision** | Upload an image; a vision-capable model describes or analyses it and reads any text |
| 12 | **Data Analysis** | Upload a CSV/spreadsheet and ask questions; backend runs safe pandas operations and auto-generates a matching chart |
| 13 | **Code Agent** | Sandboxed file-tree workspace: write, read and run `.py` / `.js` projects — never touches your real filesystem |
| 14 | **Compare Models** | Run the same prompt against two different local Ollama models side by side |
| 15 | **Teacher / Quiz Mode** | Interactive English tutoring and quiz flow with 10 lesson types, 5 levels, and 4 teaching styles |
| 16 | **Convert** | Convert files between formats — images, documents, data, audio, archives |
| 17 | **Universal Generate (docgen)** | Generate structured output files (DOCX, PDF, PPTX, XLSX, MD, HTML, TXT) from a plain-language prompt |
| 18 | **Workflows** | Save and replay named automation chains that combine tools (backend API) |
| 19 | **Voice** | Speech-to-text (faster-whisper), text-to-speech (Piper — English + Telugu), and voice cloning |
| 20 | **Personalities** | Save custom named personas (system prompt + preferred model); switch any chat between them |
| 21 | **Settings** | Configure Ollama URL, backend URL, per-tool model selection, default styles, and more |
| 22 | **System / GPU Panel** | Live GPU slot status, loaded Ollama models, and a manual reset — available via backend API at `/system/gpu-status` |

---

## Screenshots

### Home Screen
The clean home screen with the full tool bar. Every tool is one click away.

![Home Screen](docs/screenshots/homepage.png)

---

### Normal Chat — Code Response
Streamed syntax-highlighted code response from the local Ollama model.

![Chat with code response](docs/screenshots/queryandresponse.png)

---

### Thinking Indicator
Live "Thinking…" indicator while the model streams its response.

![Thinking indicator](docs/screenshots/thinking.png)

---

### Smart Mode — Auto Image Generation
Smart Mode active (highlighted button, bottom right). The prompt `Draw a cute robot reading a book` was auto-classified as an image task and fired ComfyUI — no manual tool selection needed.

![Smart Mode auto image generation](docs/screenshots/realticimagegeninsmartmode.png)

---

### Creative Studio — Illustrative Style
Image generated from the prompt `A cozy cabin in snowy mountains at sunset, cinematic lighting` in **Illustrative** style.

![Illustrative image generation](docs/screenshots/illustrative.png)

---

### Creative Studio — Realistic Style
Same prompt rendered in **Realistic** style via a different ComfyUI checkpoint.

![Realistic image generation](docs/screenshots/realsticiamgegen.png)

---

### Creative Studio — CyberRealistic Style
Same prompt in **CyberRealistic** style — richer shadows and cinematic colour grading.

![CyberRealistic image generation](docs/screenshots/cyberrealstic.png)

---

### Creative Studio — Enhance Menu
Click **Enhance** on any generated image to open the enhancement menu: Face fix (GFPGAN), Upscale (Real-ESRGAN), Remove background (rembg), and Color grade — run in any combination.

![Image enhance menu](docs/screenshots/aiimagetoolmenu.png)

---

### Creative Studio — Upscaling in Progress
Upscaling running live — status indicator shows `● Upscale` while the enhanced image is being processed.

![Upscaling in progress](docs/screenshots/upscalingimage.png)

---

### Creative Studio — Before & After Enhancement
Side-by-side comparison of the original and the enhanced image after running the enhance pipeline.

![Before and after enhancement](docs/screenshots/imagebforeenhanceandafterenhancecomparisonimage.png)

---

### Creative Studio — Prompt-guided Edit
Before and after applying a prompt-guided edit (`make the sky purple`) to an existing generated image.

![Image prompt editing before and after](docs/screenshots/imageprompteditingbforeandafter.png)

---

### SVG Studio — Vector Generation
SVG generated inline — shows the rendered graphic, Download SVG, Copy code, and Show design brief buttons.

![SVG generation](docs/screenshots/svgimagegen.png)

---

### Chart Builder — Bar Chart from Prompt
Bar chart of monthly sales generated from a plain-language prompt, rendered inline via Chart.js with hover tooltips. Downloadable as PNG or CSV.

![Bar chart from prompt](docs/screenshots/chartmodebargraphgenbyprompt.png)

---

### Chart Builder — Line Graph from CSV
Line graph generated by uploading `sales.csv` and asking for a regional revenue comparison.

![Line graph from CSV](docs/screenshots/linegraphgen.png)

---

### Chart Builder — Pie Chart
Pie chart generated from a natural-language prompt.

![Pie chart](docs/screenshots/piechart.png)

---

### Diagram Studio — Flowchart
User login flowchart with password reset path, rendered via Mermaid.

![Flowchart diagram](docs/screenshots/diagrammodeflowchart.png)

---

### Diagram Studio — Sequence Diagram
Browser → Backend → Database sequence diagram for an order checkout flow.

![Sequence diagram](docs/screenshots/sequencediagram.png)

---

### Diagram Studio — Mind Map
Mind map of machine learning topics, rendered via Mermaid.

![Mind map diagram](docs/screenshots/mindmap.png)

---

### Web Search — Source Cards
Live web search result with categorised source cards (Research tab shown), confidence indicator, and full page text extraction.

![Web search results](docs/screenshots/webserch.png)

---

### Web Search — Image Results
Web search showing image results tab from SearXNG.

![Web search image results](docs/screenshots/websearchgptimages.png)

---

### Knowledge / RAG — Collections Manager
The Knowledge Collections modal: create collections, upload files (PDF shown — `Talagaturi-Vivek-Portfolio.pdf`, 6 chunks), add more files, and select the active collection.

![Knowledge collections manager](docs/screenshots/knowledgemodemenu.png)

---

### Knowledge / RAG — Cited Answer
A question answered strictly from the uploaded knowledge base, with citations from the ingested document.

![Knowledge base answer](docs/screenshots/knowledgebaseanswers.png)

---

### Knowledge / RAG — Asking Questions
Follow-up question from the knowledge base showing the grounded, citation-style response.

![Asking questions from knowledge base](docs/screenshots/askingquestionsfromknowledegbase.png)

---

### Document Upload — File Chips
Files attached directly in the composer as chips — PDF and other documents ready for context injection.

![Attach files as chips](docs/screenshots/attachfileinchips.png)

---

### Document Upload — Response from File
Response generated from an uploaded document — content extracted and used as conversation context.

![Response from attached file](docs/screenshots/responsefromattatchfileonquery.png)

---

### Vision — Image Analysis
An image attached for vision analysis; the model describes the content and reads text from the image.

![Vision image analysis](docs/screenshots/responsefromiamgeanaylisquery.png)

---

### Vision — Attach & Query
The image attached in the composer and the query sent for analysis.

![Attach image and query](docs/screenshots/imageanalysisattaching%20imageandquery.png)

---

### Data Analysis — CSV Upload & Question
A CSV uploaded via the spreadsheet button; a plain-language question answered by the backend using pandas.

![CSV analysis question](docs/screenshots/attchcsvandaskingquestions.png)

---

### Data Analysis — CSV Analysis Result
Detailed breakdown from the uploaded CSV data, showing which region had the highest revenue.

![CSV analysis result](docs/screenshots/csvanaysis.png)

---

### Data Analysis — Another CSV Question
Follow-up data question answered from the same uploaded spreadsheet.

![Another CSV question](docs/screenshots/anothercsvquestion.png)

---

### Data Analysis — Excel/CSV Chart
Chart auto-generated from the uploaded spreadsheet data.

![Excel CSV chart analysis](docs/screenshots/xcelcsvanalysixbyuploadingcsv.png)

---

### Code Agent — Sandboxed File Tree
The Code Agent panel open on the right: file tree shows `README.md`, `app.py` and `index.html` — a Flask app being built. The coding agent tooltip is visible on the toolbar.

![Code agent interface](docs/screenshots/codingagentinterface.png)

---

### Code Agent — Response
The agent's response showing the files it wrote and how to run the project.

![Code agent response](docs/screenshots/codingagentresponse.png)

---

### Teacher Mode — Lesson Menu
The English Teacher toggle open with lesson type, level, and teaching style selectors. Ten lesson types: Conversation practice, Grammar correction, Quiz me, Tell me a story, Writing practice, Pronunciation, Vocabulary builder, Real-world roleplay, Debate & discussion, Exam prep (TOEFL/IELTS-style).

![English teacher lesson menu](docs/screenshots/englishteachermenu.png)

---

### Teacher Mode — Grammar Correction
Grammar correction lesson: the model corrects submitted sentences and explains each error.

![Grammar practice correction](docs/screenshots/grammerpractice.png)

---

### Teacher Mode — Quiz Round 1
Quiz mode in progress — question shown with multiple choice options.

![Quiz round 1](docs/screenshots/quizplay.png)

---

### Teacher Mode — Quiz Round 2
Follow-up quiz question with score tracking and difficulty adaptation.

![Quiz round 2](docs/screenshots/quizplay2.png)

---

### Convert Mode — PNG to JPG Input
Convert mode active: a PNG file attached and the request to convert it to JPG.

![Conversion mode PNG to JPG](docs/screenshots/conversionmodeattachinhpngandaskingtoconvertinjpg.png)

---

### Convert Mode — JPG Output
Converted JPG file served as a download card.

![Conversion output JPG](docs/screenshots/conversionfileoutputinjpg.png)

---

### Convert Mode — Markdown to PDF
A `.md` file converted to PDF using pandoc + LibreOffice, served as a download.

![Markdown to PDF conversion](docs/screenshots/mdtopdf.png)

---

### Universal Generate — File Type Menu
The generate tool's output format menu: DOCX, PDF, PPTX, XLSX, MD, HTML, TXT, CSV.

![Generate file menu](docs/screenshots/generatingfilemenu.png)

---

### Universal Generate — DOCX + PPTX Output
A project proposal generated as a Word document and a 5-slide PowerPoint, both served as download cards.

![DOCX and PPTX generation](docs/screenshots/docxandpptgeneration.png)

---

### Voice — Speech to Text
Voice typing in action: spoken words transcribed by faster-whisper and placed into the composer.

![Voice typing STT](docs/screenshots/voicetyping.png)

---

### Voice — Text to Speech Playback
Any AI response can be read aloud using the Piper TTS engine (English or Telugu voice).

![Voice TTS playback](docs/screenshots/responserealoud.png)

---

### Personalities — Pirate Tutor Response
A custom persona (`Pirate Tutor`) applied to the chat. The prompt `Explain photosynthesis` answered entirely in pirate-teacher style.

![Personality response](docs/screenshots/arthesticresponseonpersonality.png)

---

### Settings — Connection & Image/SVG
Settings modal showing the Connection section (Ollama URL live, Backend URL live) and Image & SVG section (default style, SVG model, Think toggle).

![Settings connection and image](docs/screenshots/setingsmenu1.png)

---

### Settings — Voice & More
Settings modal scrolled to the Voice section: Whisper model, Piper voice selection, voice clone library and recorder.

![Settings voice and more](docs/screenshots/setingsmenu2.png)

---

### Settings — Personalities & Appearance
Settings modal showing the Personalities editor and Appearance (theme) section.

![Settings personalities](docs/screenshots/setingsmenu3.png)

---

### Backend API — Full Endpoint Reference
The FastAPI auto-generated docs at `http://localhost:8008/docs` showing every available endpoint across all routers.

![Backend API docs](docs/screenshots/backendworkflow.png)

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser  (http://localhost:5173)       │
│  React 18 + Vite  (src/)               │
│  ├─ App.jsx          — main shell       │
│  ├─ components/      — UI components   │
│  └─ lib/tools/       — tool clients    │
└───────────────┬─────────────────────────┘
                │ fetch / EventSource
┌───────────────▼─────────────────────────┐
│  FastAPI backend  (http://localhost:8008)│
│  backend/main.py                        │
│  ├─ routers/image.py   → ComfyUI :8188  │
│  ├─ routers/vision.py  → Ollama  :11434 │
│  ├─ routers/voice.py   → Whisper/Piper  │
│  ├─ routers/search.py  → SearXNG :8888  │
│  ├─ routers/browser.py → Playwright     │
│  ├─ routers/rag.py     → ChromaDB       │
│  ├─ routers/svg.py     → Ollama  :11434 │
│  ├─ routers/code.py    — sandbox        │
│  ├─ routers/convert.py — Pillow/pandoc  │
│  ├─ routers/data.py    — pandas         │
│  ├─ routers/universal_generate.py       │
│  └─ routers/workflows.py                │
└─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Local services (you run these)         │
│  • Ollama          :11434               │
│  • ComfyUI         :8188  (image gen)   │
│  • SearXNG (Docker):8888  (web search)  │
└─────────────────────────────────────────┘
```

---

## Requirements

### System

| Dependency | Version | Notes |
|---|---|---|
| **Node.js** | 18 + | For the Vite/React frontend |
| **Python** | 3.10 + | For the FastAPI backend |
| **Ollama** | latest | Download from [ollama.com](https://ollama.com) |
| **Docker** | latest | Required only for Web Search (SearXNG container) |
| **ComfyUI** | latest | Required only for image generation |

### Recommended Ollama models

```bash
ollama pull qwen3:4b              # default chat model
ollama pull qwen2.5-coder:7b      # code agent, SVG, chart/diagram planning
ollama pull nomic-embed-text      # RAG embeddings
ollama pull gemma3:4b             # vision (fits 6 GB VRAM)
ollama pull qwen2.5vl:7b          # vision (heavier, more capable)
```

### Python packages

```bash
pip install -r backend/requirements.txt
```

| Package | Used for |
|---|---|
| `fastapi` + `uvicorn` | Backend web server |
| `pypdf`, `python-docx`, `openpyxl`, `python-pptx` | Document extraction & docgen |
| `chromadb` | RAG / Knowledge vector store |
| `httpx` | Async HTTP calls to Ollama / SearXNG / ComfyUI |
| `pandas`, `matplotlib` | Data analysis & charting |
| `reportlab` | PDF generation |
| `trafilatura` | Web page text extraction (Search) |
| `youtube-transcript-api` | YouTube transcript extraction |
| `playwright` | Browser Agent |
| `Pillow` | Image conversion |
| `faster-whisper` | Voice transcription (STT) |
| `piper-tts` | Voice playback (TTS) |

### Optional — GPU image enhancement

```bash
# GPU build (pick the CUDA version matching your driver)
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install onnxruntime-gpu
pip install gfpgan realesrgan basicsr rembg

# CPU-only machine
pip install onnxruntime
```

### System binaries

```bash
# Ubuntu / Pop!_OS
sudo apt install ffmpeg pandoc libreoffice poppler-utils

# Arch
sudo pacman -S ffmpeg pandoc libreoffice poppler
```

| Binary | Used for |
|---|---|
| `ffmpeg` | Audio conversions, video → audio extraction |
| `pandoc` | MD ↔ DOCX ↔ TXT conversion |
| `libreoffice` (`soffice`) | DOCX → PDF conversion |
| `pdftoppm` (poppler) | PDF → images conversion |

### SearXNG (Web Search)

```bash
docker run -d --name searxng -p 8888:8080 searxng/searxng
```

The backend auto-starts the `searxng` Docker container on boot via `searxng_manager.py`.

### ComfyUI (Image Generation)

Start ComfyUI on port `8188`. Place checkpoints in `models/checkpoints/`:

| File | Style |
|---|---|
| `dreamshaper8.safetensors` | Illustrative |
| `realisticVisionV60.safetensors` | Realistic |
| `cyberrealistic.safetensors` | CyberRealistic |

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/24B11CS433vivek/loq-ai-workspace.git
cd loq-ai-workspace

# 2. Install frontend dependencies
npm install

# 3. Install backend Python dependencies
pip install -r backend/requirements.txt

# 4. Install Playwright browsers (Browser Agent)
python -m playwright install chromium
```

---

## Running the App

### Option A — One command

```bash
npm start
```

Runs the frontend Vite dev server and the FastAPI backend together via `concurrently`.

### Option B — Two terminals (recommended for debugging)

**Terminal 1 — Backend:**
```bash
bash run-backend.sh
# FastAPI on http://localhost:8008
```

**Terminal 2 — Frontend:**
```bash
npm run dev
# Vite on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

### Start external services first

```bash
ollama serve                # if not running as a system service
docker start searxng        # for Web Search
# start ComfyUI separately  # for image generation
```

---

## Tool Reference

### Creative Studio (Image)
- **Generate**: Type a prompt → choose style (Illustrative / Realistic / CyberRealistic) → ComfyUI on `:8188`
- **Enhance**: Click Enhance on any image → Face fix (GFPGAN), Upscale 2×/4× (Real-ESRGAN), Remove background (rembg), Color grade — run in any combination
- **Edit**: Click Edit → describe a change in plain text → prompt-guided editing applied

### SVG Studio
- Describe what you want → backend calls the configured SVG model (default `gemma3:4b`)
- Styles: `icon`, `logo`, `illustration`, `badge`
- Enable **Think** to run a design brief pass before generating for better results

### Chart Builder
- Type a plain-language chart request or upload a CSV/spreadsheet
- Supports bar, line, pie, scatter and more
- Rendered inline via Chart.js; Download PNG or CSV

### Diagram Studio
- Describe any diagram → Mermaid markup generated and rendered
- Supports: flowcharts, sequence diagrams, architecture diagrams, mind maps

### Web Search
- Routes through local SearXNG (`:8888`) — no external API keys
- Searches general, news, images, videos, research, science, social
- Extracts full page text from top results (Trafilatura)
- Fetches YouTube transcripts automatically for video results

### Browser Agent
- Playwright (Chromium) under the hood
- Actions: navigate, click, fill, scroll, screenshot
- One session per conversation, hard timeout per action

### Knowledge / RAG
- Create named collections, upload PDFs / DOCX / TXT
- Chunked, embedded with `nomic-embed-text`, stored in ChromaDB
- Queries return cited chunks from your own documents only
- Answers come **only** from the active collection when Knowledge mode is on

### Voice
- **Transcribe**: speak into mic → faster-whisper (small model, CPU) → text in the composer
- **Speak**: any response → Piper TTS → audio playback (English `en_US-lessac` or Telugu `te_IN-padmavathi`)
- **Clone**: record a 5–30 s sample → clone that voice → TTS in the cloned voice

### Teacher Mode
- 10 lesson types: Conversation practice, Grammar correction, Quiz me, Tell me a story, Writing practice, Pronunciation, Vocabulary builder, Real-world roleplay, Debate & discussion, Exam prep (TOEFL/IELTS-style)
- 5 levels: Beginner (A1) through Advanced (C1)
- 4 teaching styles: Professional, Friendly, Strict, Socratic

### Code Agent
- Sandboxed workspace at `backend/data/code_projects/<project>/`
- Write files, read files, run `.py` / `.js` with a 15-second hard timeout
- Never touches your real filesystem

### Convert
- Images: PNG ↔ JPG ↔ WEBP ↔ HEIC ↔ SVG (Pillow + cairosvg)
- Documents: MD ↔ DOCX ↔ TXT (pandoc), DOCX → PDF (LibreOffice)
- PDFs: merge, split, rotate, compress, PDF → images (poppler)
- Data: CSV ↔ XLSX ↔ JSON (pandas + openpyxl)
- Audio: any format via ffmpeg
- Archives: zip / extract

### Universal Generate (docgen)
- Describe what you want → backend plans structure with Ollama → renders a real file
- Output formats: `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.md`, `.html`, `.txt`, `.csv`
- Served back as a download link

---

## Configuration & Settings

Open **Settings** (gear icon) in the UI:

| Setting | Default | Notes |
|---|---|---|
| Ollama URL | `http://localhost:11434` | Change if Ollama is on another port or machine |
| Backend URL | `http://localhost:8008` | Change if you remapped the backend port |
| Chat model | _(auto-detect first available)_ | Picked per-session |
| SVG model | `gemma3:4b` | Any Ollama model |
| Default image style | `Illustrative` | Illustrative / Realistic / CyberRealistic |
| Default SVG style | `Icon` | Icon / Logo / Illustration / Badge |
| Think before SVG | `on` | Off = skip design brief, faster generation |

Environment variables for the backend:

| Variable | Default | Notes |
|---|---|---|
| `SEARXNG_URL` | `http://localhost:8888` | SearXNG endpoint |
| `SEARXNG_CONTAINER_NAME` | `searxng` | Docker container name |
| `WHISPER_MODEL_SIZE` | `small` | faster-whisper model size |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | faster-whisper compute type |

---

## Project Structure

```
loq-ai-workspace/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, startup hooks, router mounts
│   ├── requirements.txt         # Python dependencies
│   ├── gpu_manager.py           # Shared GPU slot (prevents concurrent heavy jobs)
│   ├── searxng_manager.py       # Auto-start/heal SearXNG Docker container
│   ├── browser_agent.py         # Playwright agent logic
│   ├── browser_controller.py    # Playwright session manager
│   ├── workflows.py             # Workflow persistence
│   ├── docgen/                  # Document generation pipeline
│   │   ├── extraction.py        # Source extraction from uploads/pastes
│   │   ├── planner.py           # Ollama plans the document structure
│   │   ├── renderers.py         # Format-native file rendering
│   │   └── spec.py              # Output spec dataclasses
│   ├── routers/
│   │   ├── image.py             # Creative Studio (ComfyUI + enhance chain)
│   │   ├── vision.py            # Vision (Ollama multimodal)
│   │   ├── voice.py             # STT (Whisper) + TTS (Piper) + voice clone
│   │   ├── search.py            # Web Search (SearXNG + page extraction)
│   │   ├── browser.py           # Browser Agent (Playwright)
│   │   ├── rag.py               # Knowledge / RAG (ChromaDB)
│   │   ├── svg.py               # SVG Studio (Ollama)
│   │   ├── code.py              # Code Agent sandbox
│   │   ├── convert.py           # File conversion
│   │   ├── data.py              # Data Analysis (pandas)
│   │   ├── documents.py         # Document upload/extraction
│   │   ├── universal_generate.py# docgen entry point
│   │   ├── workflows.py         # Workflow CRUD
│   │   └── system.py            # GPU status + diagnostics
│   ├── voice_models/            # Piper TTS ONNX config files
│   └── data/code_projects/      # Code Agent sandboxed filesystems
├── src/
│   ├── App.jsx                  # Main React shell, all tool orchestration
│   ├── main.jsx                 # React entry point
│   ├── components/
│   │   ├── Sidebar.jsx          # Chat session list
│   │   ├── Composer.jsx         # Input bar + all tool toggles
│   │   ├── Message.jsx          # Chat message renderer
│   │   ├── SettingsModal.jsx    # Settings UI
│   │   ├── ArtifactPanel.jsx    # HTML artifact fullscreen panel
│   │   └── tools/               # Per-tool UI cards and toggles
│   ├── lib/
│   │   ├── ollama.js            # Ollama HTTP client (stream chat, list models)
│   │   ├── storage.js           # localStorage helpers + IDENTITY_SYSTEM_PROMPT
│   │   ├── backend.js           # Backend URL helper
│   │   └── tools/               # Per-tool frontend logic
│   │       ├── smartRouter.js   # Smart Mode intent classifier
│   │       ├── imagegen.js      # Image generation/enhancement client
│   │       ├── svg.js           # SVG Studio client
│   │       ├── chartEngine.js   # Chart planning + rendering
│   │       ├── diagram.js       # Diagram (Mermaid) client
│   │       ├── websearch.js     # Web search client
│   │       ├── browserAgent.js  # Browser Agent client
│   │       ├── rag.js           # RAG client
│   │       ├── vision.js        # Vision client
│   │       ├── voice.js         # Voice (STT/TTS/clone) client
│   │       ├── codeAgent.js     # Code Agent client
│   │       ├── compareModels.js # Compare Models client
│   │       ├── dataAnalysis.js  # Data Analysis client
│   │       ├── documents.js     # Document upload client
│   │       ├── convert.js       # File conversion client
│   │       ├── generate.js      # docgen client
│   │       ├── teacherEngine.js # Teacher/Quiz logic
│   │       └── htmlArtifact.js  # HTML artifact renderer
│   └── styles/theme.css         # Dark/light theme tokens
├── docs/screenshots/            # All feature screenshots
├── index.html                   # Vite entry HTML
├── package.json                 # Frontend deps (React 18, Vite, Chart.js, Mermaid, marked, highlight.js)
├── vite.config.js               # Vite config (port 5173)
└── run-backend.sh               # Start backend: uvicorn on 127.0.0.1:8008
```

---

## Backend API

The full interactive API reference is available at `http://localhost:8008/docs` when the backend is running.

Key endpoint groups:

| Group | Endpoints |
|---|---|
| `documents` | `POST /tools/document/extract` |
| `convert` | `POST /tools/convert` |
| `rag` | `GET/POST /tools/rag/collections`, `POST /tools/rag/ingest`, `POST /tools/rag/query` |
| `search` | `POST /tools/search/web` |
| `data` | `POST /tools/data/analyze`, `POST /tools/data/chart` |
| `universal-generate` | `POST /tools/universal-generate` |
| `image` | `POST /tools/image/generate`, `/upload`, `/enhance`, `/edit` |
| `vision` | `POST /tools/vision/describe` |
| `voice` | `POST /tools/voice/transcribe`, `/speak`, `/clone` |
| `svg` | `POST /tools/svg/generate` |
| `code` | `GET /tools/code/tree`, `POST /tools/code/write`, `/read`, `/run` |
| `browser` | `POST /tools/browser/start`, `/act`, `/task`, `/close` |
| `workflows` | `GET/POST /tools/workflows`, `PUT/DELETE /tools/workflows/{id}` |
| `system` | `GET /system/gpu-status`, `/ollama-models`, `POST /system/gpu-reset` |

---

## Troubleshooting

### Backend won't start — port 8008 in use
```bash
fuser -k 8008/tcp
bash run-backend.sh
```

### Frontend can't reach backend (red indicator in Settings)
Open the browser console (F12) and run:
```javascript
const s = JSON.parse(localStorage.getItem('lai-settings') || '{}');
s.backendUrl = 'http://localhost:8008';
localStorage.setItem('lai-settings', JSON.stringify(s));
location.reload();
```

### Web Search always fails
```bash
docker ps -a | grep searxng
docker start searxng
curl http://localhost:8888/config   # should return JSON
```

### Image generation times out
- Make sure ComfyUI is running on port `8188`
- Place at least one checkpoint in ComfyUI's `models/checkpoints/`
- Test: `curl http://localhost:8188/system_stats`

### CUDA warnings on backend startup
The `CUDAExecutionProvider` warnings from rembg/onnxruntime are harmless without a CUDA build. Background removal runs on CPU (slower but works).

### Whisper / Piper not found
```bash
pip install faster-whisper piper-tts
# Download Piper voice model files and point PIPER_VOICES_DIR to them
```

---

## Author

**Vivek Talagaturi** — Full-Stack Developer & CSE undergrad (B.Tech 2024–2028)

- GitHub: [github.com/24B11CS433vivek](https://github.com/24B11CS433vivek)
- LinkedIn: [linkedin.com/in/talagaturi-vivek](https://linkedin.com/in/talagaturi-vivek)
- Email: vivektalagaturi@gmail.com

> Built as a local, private-first alternative to cloud AI tools — everything runs on your own hardware.
