# LOQ AI Workspace

> A fully local, private-first AI assistant with 20+ built-in tools — built by **Vivek Talagaturi** ([@24B11CS433vivek](https://github.com/24B11CS433vivek)).

No cloud. No API keys. Runs entirely on your own machine using a local [Ollama](https://ollama.com) model + a local FastAPI backend. Only **Web Search** and **Browser Agent** ever touch the live internet, and only when you trigger them.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Tool Reference](#tool-reference)
- [Configuration & Settings](#configuration--settings)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Author](#author)

---

## Features

| # | Tool / Mode | What it does |
|---|---|---|
| 1 | **Normal Chat** | Everyday conversation, writing, code help, math — streamed token-by-token from a local Ollama model |
| 2 | **Smart Mode** | Toggle in the composer — auto-classifies each message (image / svg / chart / diagram / browser / search / chat) and fires the right tool automatically |
| 3 | **Creative Studio (Image)** | Generate images from a text prompt (illustrative / realistic / cyberrealistic styles via ComfyUI) or upload your own photo and enhance it (face restoration, upscaling, background removal, color grading) |
| 4 | **SVG Studio** | Generate clean vector SVG icons, logos, badges, and illustrations from a prompt; optional "think" pass plans a design brief first |
| 5 | **Chart Builder** | Turn a plain-language request or an uploaded CSV/spreadsheet into a rendered bar / line / pie / etc. chart |
| 6 | **Diagram Studio** | Generate flowcharts, sequence diagrams, architecture diagrams, and mind maps from a description (Mermaid-powered) |
| 7 | **Web Search** | Live web lookups via a local SearXNG instance (auto-started on backend boot) — results shown as source cards with page-text extraction |
| 8 | **Browser Agent** | Autonomous agent that starts a real Playwright browser session, navigates websites, clicks, fills forms, and completes multi-step live web tasks |
| 9 | **Knowledge / RAG** | Create named knowledge collections, upload files (PDF, DOCX, TXT…), and query strictly against that material for grounded, citation-style answers (ChromaDB + nomic-embed-text) |
| 10 | **Document Upload in Chat** | Attach PDFs, spreadsheets, DOCX, PPTX directly to a conversation — content is extracted and injected as context |
| 11 | **Vision** | Upload an image; a vision-capable model (gemma3:4b / qwen2.5vl:7b) describes or analyzes it |
| 12 | **Data Analysis** | Upload a CSV/spreadsheet and ask questions in plain language; backend runs safe, whitelisted pandas operations and can auto-generate a matching chart |
| 13 | **Code Agent** | Sandboxed file-tree workspace: write files, read files, run `.py` / `.js` projects — never touches your real filesystem |
| 14 | **Compare Models** | Run the same prompt against two different local Ollama models side-by-side in a split view |
| 15 | **Teacher / Quiz Mode** | Interactive tutoring and quiz flow that tracks weak spots across turns |
| 16 | **Convert** | Convert files between formats — images (PNG/JPG/WEBP/HEIC/SVG), documents (MD↔DOCX↔TXT↔PDF), data (CSV↔XLSX↔JSON), audio (via ffmpeg), archives (zip) |
| 17 | **Universal Generate (docgen)** | Generate structured output files (DOCX, PDF, PPTX, XLSX, MD, HTML, TXT) from a plain-language prompt or uploaded source material |
| 18 | **Workflows** | Save and replay named automation chains that combine tools |
| 19 | **Voice** | Speech-to-text transcription (faster-whisper), text-to-speech playback (Piper — English `en_US-lessac` + Telugu `te_IN-padmavathi`), and voice cloning (record a sample → speak new text in that voice) |
| 20 | **Personalities** | Save custom named personas (system prompt + preferred model); switch any chat between them |
| 21 | **Settings** | Configure Ollama URL, backend URL, per-tool model selection, default image/SVG styles, and more |
| 22 | **System / GPU Panel** | Live view of the shared GPU slot status, Ollama-loaded models, and a manual reset control |

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
ollama pull gemma3:4b             # vision (fits 6GB VRAM fully)
ollama pull qwen2.5vl:7b          # vision (heavier, more capable)
```

### Python packages

```bash
pip install -r backend/requirements.txt
```

Core packages installed by that command:

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

### Optional (install separately for full image enhancement)

```bash
# GPU build — pick the CUDA version matching your driver:
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install onnxruntime-gpu
pip install gfpgan realesrgan basicsr rembg

# CPU-only box: use onnxruntime instead — image.py falls back automatically
pip install onnxruntime
```

### System binaries (OS package manager)

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
# Quick Docker setup
docker run -d --name searxng -p 8888:8080 searxng/searxng
```

The backend auto-starts/restarts the `searxng` Docker container on boot via `searxng_manager.py`. Set `SEARXNG_CONTAINER_NAME` and `SEARXNG_COMPOSE_DIR` env vars to match your setup if different.

### ComfyUI (Image Generation)

Follow the [ComfyUI install guide](https://github.com/comfyanonymous/ComfyUI). Start it on port `8188` before using image gen. Place model checkpoints in ComfyUI's `models/checkpoints/`:

| File | Style |
|---|---|
| `dreamshaper8.safetensors` | Illustrative |
| `realisticVisionV60.safetensors` | Realistic |
| `cyberrealistic.safetensors` | Cyberrealistic |

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

### Option A — One command (both servers together)

```bash
npm start
```

This uses `concurrently` to run the frontend Vite dev server and the backend together.

### Option B — Two terminals (recommended for debugging)

**Terminal 1 — Backend:**
```bash
bash run-backend.sh
# Starts FastAPI on http://localhost:8008
```

**Terminal 2 — Frontend:**
```bash
npm run dev
# Starts Vite on http://localhost:5173
```

Then open **http://localhost:5173** in your browser.

### Make sure external services are running first

```bash
ollama serve                      # if not running as a system service
docker start searxng              # for Web Search
# start ComfyUI separately        # for image generation
```

---

## Tool Reference

### Creative Studio (Image)
- **Generate mode**: Type a prompt → choose style (illustrative / realistic / cyberrealistic) → sends to ComfyUI on `:8188`
- **Upload mode**: Upload a photo → apply face restoration (GFPGAN), upscaling (Real-ESRGAN), background removal (rembg), or color grading
- **Edit mode**: Upload image + text prompt → prompt-guided editing

### SVG Studio
- Describe what you want → backend calls `qwen2.5-coder:7b` (or your configured SVG model)
- Styles: `icon`, `logo`, `illustration`, `badge`
- Enable **Think** to get a design brief pass before generating

### Chart Builder
- Type a plain-language chart request OR upload a CSV/spreadsheet
- Supports bar, line, pie, scatter, and more
- Rendered inline via Chart.js

### Diagram Studio
- Describe any diagram → Mermaid markup generated and rendered
- Supports: flowcharts, sequence diagrams, architecture diagrams, mind maps

### Web Search
- Routes through local SearXNG (`:8888`) — no external API keys
- Searches general, news, images, videos, files, science, shopping, social
- Extracts full page text from top results (Trafilatura)
- Fetches YouTube transcripts automatically for video results

### Browser Agent
- Playwright (Chromium) under the hood
- Actions: navigate, click, fill, scroll, screenshot
- One session per conversation, hard timeout per action

### Knowledge / RAG
- Create named collections, upload PDFs/DOCX/TXT
- Chunked, embedded with `nomic-embed-text`, stored in ChromaDB
- Queries return cited chunks from your own documents only

### Voice
- **Transcribe**: speak into mic → faster-whisper (small model, CPU) → text in the composer
- **Speak**: any response → Piper TTS → audio playback (English or Telugu)
- **Clone**: record a 5–30s sample → clone that voice → TTS with the cloned voice

### Code Agent
- Sandboxed workspace at `backend/data/code_projects/<project>/`
- Write files, read files, run `.py` / `.js` with a 15-second hard timeout
- Uses `qwen2.5-coder:7b` for code generation

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
- Served back as a download link via `/files` static mount

---

## Configuration & Settings

Open **Settings** (gear icon) in the UI to configure:

| Setting | Default | Notes |
|---|---|---|
| Ollama URL | `http://localhost:11434` | Change if Ollama is on another port/machine |
| Backend URL | `http://localhost:8008` | Change if you remapped the backend port |
| Chat model | _(auto-detect first available)_ | Picked per-session |
| SVG model | `qwen2.5-coder:7b` | Any Ollama model |
| Default image style | `illustrative` | `illustrative` / `realistic` / `cyberrealistic` |
| Image input mode | `generate` | `generate` (prompt) or `upload` (enhance own photo) |
| SVG think pass | `on` | Off = skip design brief, faster generation |

Environment variables for the backend:

| Variable | Default | Notes |
|---|---|---|
| `SEARXNG_URL` | `http://localhost:8888` | SearXNG endpoint |
| `SEARXNG_CONTAINER_NAME` | `searxng` | Docker container name |
| `SEARXNG_COMPOSE_DIR` | `~/searxng` | Path to docker-compose dir |
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
│   │   ├── Composer.jsx         # Input bar + tool toggles
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
├── index.html                   # Vite entry HTML
├── package.json                 # Frontend deps (React 18, Vite, Chart.js, Mermaid, marked, highlight.js)
├── vite.config.js               # Vite config (port 5173)
└── run-backend.sh               # Start backend: uvicorn on 127.0.0.1:8008
```

---

## Troubleshooting

### Backend won't start — port 8008 already in use
```bash
fuser -k 8008/tcp
bash run-backend.sh
```

### Frontend can't reach backend (red indicator in Settings)
Open browser console (F12) and run:
```javascript
const s = JSON.parse(localStorage.getItem('lai-settings') || '{}');
s.backendUrl = 'http://localhost:8008';
localStorage.setItem('lai-settings', JSON.stringify(s));
location.reload();
```

### Web Search always fails
```bash
docker ps -a | grep searxng       # check if container exists
docker start searxng              # start it manually
curl http://localhost:8888/config # should return JSON if it's up
```

### Image generation times out
- Make sure ComfyUI is running on port `8188`
- Place at least one checkpoint in ComfyUI's `models/checkpoints/`
- Check `curl http://localhost:8188/system_stats`

### CUDA warnings on backend startup
The `CUDAExecutionProvider` warnings from rembg/onnxruntime are harmless if you don't have a CUDA build. Background removal will run on CPU (slower, but works).

### Whisper / Piper not found
```bash
pip install faster-whisper piper-tts
# Download Piper voice models and set PIPER_VOICES_DIR
```

---

## Author

**Vivek Talagaturi** — Full-Stack Developer & CSE undergrad (B.Tech 2024–2028)

- GitHub: [github.com/24B11CS433vivek](https://github.com/24B11CS433vivek)
- LinkedIn: [linkedin.com/in/talagaturi-vivek](https://linkedin.com/in/talagaturi-vivek)
- Email: vivektalagaturi@gmail.com

> Built as a local, private-first alternative to cloud AI tools — everything runs on your own hardware.
