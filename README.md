<p align="center">
  <img src="./assets/branding/sally-logo.png" alt="Sally logo" width="220" />
</p>

<h1 align="center">Sally — The AI Screen Reader That Sees, Understands, and Acts</h1>

<p align="center">
  <strong>Built for the Gemini Live Agent Challenge | UI Navigator Track</strong><br/>
  Powered by Gemini 2.5 Flash, Google Cloud Run, optional Google Cloud Logging, and the <code>@google/genai</code> SDK
</p>

---

Sally is a **voice-first accessibility agent** for people with motor impairments, repetitive strain injuries, cognitive disabilities, or anyone who wants faster, hands-free web interaction. It lets people control websites using only their voice, with no mouse, no keyboard, and no complex navigation required.

**The killer feature: "What do I see?"** Hold the push-to-talk key, ask the question, and Sally captures a screenshot, sends it to **Gemini 2.5 Flash** for multimodal vision analysis, and speaks back a natural-language description of what's on screen.

**The second killer feature: the Sally browser.** For browser tasks, Sally opens and reuses its own persistent Electron browser window, keeps sessions between launches, captures the live browser screenshot, extracts DOM and page context, and lets Gemini plan one precise next action at a time.

## How It Works

```
Voice Command ──► Gemini STT ──► Intent Router
                                      │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                  "What do I see?"  "Click X"    "Search for Y"
                        │              │              │
                        ▼              ▼              ▼
                  Gemini Vision   Agentic Loop    Agentic Loop
                  (describe)   (Sally Browser) (Sally Browser)
                        │              │              │
                        └──────────────┼──────────────┘
                                       ▼
                                 ElevenLabs TTS
                                       ▼
                                 Spoken Response
```

### The Agentic Loop

For action commands like `go to Gmail`, `open Canva`, `click the compose button`, or `search for weather`, Sally runs a **Gemini Vision + DOM-guided agentic loop**:

1. **Open or reuse** the Sally browser on a useful target URL
2. **Screenshot** the current live browser page from Electron `webContents`
3. **Extract DOM and page context** — visible controls, headings, dialogs, messages, focused element
4. **Send to Gemini** — "What do you see? What's the next action?"
5. **Execute** the action (`navigate`, `click`, `fill`, `type`, `select`, `press`, `hover`, `focus`, `check`, `uncheck`, `scroll`, `scroll_up`, `back`, `wait`)
6. **Narrate** each step aloud via TTS
7. **Repeat** until the task is complete (or max 15 iterations / 3 min timeout)

This means Sally can handle multi-step tasks like "go to Gmail and open compose" autonomously — navigating, focusing fields, typing, pressing Enter, and describing results — while staying inside the same persistent Sally browser session.

## Voice Flow

1. **User speaks** — Global push-to-talk hotkey (Right Alt, or Right Option on macOS) captures audio system-wide
2. **Gemini transcribes** — Audio sent to Gemini 2.5 Flash for speech-to-text
3. **Intent routes** — Sally decides whether the request is screen-only, visual Q&A, browser assistive help, or a browser control task
4. **Gemini sees** — Sally sends either a desktop screenshot or a browser screenshot plus page context to Gemini 2.5 Flash
5. **Sally acts** — The Sally browser executes DOM-first actions based on Gemini's action plan
6. **Sally speaks** — ElevenLabs neural TTS narrates every action and result
7. **Loop continues** — Take a new screenshot, ask Gemini again, until the task is done

## Architecture

```mermaid
graph TD
    A[Right Alt + Microphone] -->|push-to-talk| B[Audio Recorder]
    B -->|WebM audio| C[Gemini 2.5 Flash STT]
    C --> D{Command Router}
    D --> MAIN[Electron Main Process]

    D -->|describe| E[Desktop Screenshot]
    D -->|screen question| E
    D -->|action| SB
    D -->|smart home| EXPAND[Expand Command] --> SB

    E --> GEMINI[Gemini 2.5 Flash Vision]
    SB[Sally Browser] --> SHOT[Browser Screenshot]
    SB --> CTX[DOM + Page Context]
    SHOT --> GEMINI
    CTX --> GEMINI

    GEMINI --> TTS[ElevenLabs TTS → Speaker]
    GEMINI --> CHECK{Action?}
    CHECK -->|No — task done| IDLE[Back to Idle]
    CHECK -->|Yes| EXEC[Sally Browser: Execute DOM-first Action]
    EXEC --> SB

    MAIN --> LOGQ[Batch Logger Queue]
    LOGQ -->|POST /api/log| CR
    GEMINI -.->|Cloud Run backend| CR[Google Cloud Run]
    GEMINI -.->|direct fallback| SDK[google/genai SDK]
    CR --> GCL[Google Cloud Logging]
```

Want the full system walkthrough? See [docs/architecture.md](./docs/architecture.md) for the detailed architecture, data flow, and implementation notes.

## Google Cloud Architecture

| Component | Service | Purpose |
|-----------|---------|---------|
| **Vision Backend** | Google Cloud Run | Hosts the Gemini screen interpretation proxy |
| **Observability** | Google Cloud Logging | Optional structured agent activity logs for backend and desktop events |
| **AI Model** | Gemini 2.5 Flash | Multimodal vision — understands screenshots and generates structured actions |
| **SDK** | `@google/genai` | Official Google Gen AI SDK for Node.js |
| **Build** | Cloud Build | Builds container images on deploy |
| **Registry** | Artifact Registry | Stores built container images |

The Cloud Run backend receives a base64 PNG screenshot + user instruction + optional structured page context, calls Gemini 2.5 Flash with multimodal input, and returns structured JSON:

```json
{
  "narration": "I see Gmail with the Compose button on the left.",
  "action": { "type": "click", "selector": "Compose" }
}
```

Sally also has an optional structured logging path for hackathon demos:
- Electron main batches compact activity events and forwards them to `POST /api/log`
- the backend writes them to the `sally-agent-log` stream when `ENABLE_CLOUD_LOGGING=true`
- when Cloud Logging is not enabled, both desktop and backend fall back to local console logging

## Features

- **Gemini-powered screen understanding** — "What do I see?" uses Gemini 2.5 Flash multimodal vision
- **Voice-first interaction** — Push-to-talk with Gemini STT, every response spoken via TTS
- **Agentic browser automation** — Gemini Vision + DOM-guided browser control in a loop: screenshot → think → act → repeat
- **Persistent Sally browser** — Electron-owned browser session with cookies and login state preserved between launches
- **Real-time narration** — Every action Sally takes is narrated aloud so the user always knows what's happening
- **Structured page grounding** — Gemini sees both the live screenshot and visible page context such as buttons, fields, headings, dialogs, and messages
- **Assistive browser commands** — "What can I do here?", "What buttons are here?", "Read the errors", and similar commands answer directly from the live page
- **Multi-step task completion** — Handles complex tasks autonomously across multiple pages
- **Optional Cloud Logging integration** — Backend and desktop activity can flow into Google Cloud Logging at deploy time without changing local behavior
- **Floating assistant bar** — Minimal, non-intrusive UI with live state feedback
- **Configurable settings** — Manage Gemini, ElevenLabs, backend URL, Cloud Logging, and screen-question behavior from the settings window

## Getting Started

### Prerequisites

For the full platform, use Node.js 20+.

You'll need API keys for:
- Gemini is required for vision, browser automation, screen questions, and speech-to-text.
- ElevenLabs is required for text-to-speech.

### Desktop App

Run `npm run verify:desktop` after installing dependencies to confirm the Node version and native hotkey module.

```bash
# Install dependencies
npm install

# Start the app in development mode
npm run dev
```

Configure Gemini and ElevenLabs in the Settings window after launch.

If you are using a deployed Sally Vision Backend, paste the Cloud Run URL into Settings as well.

For the desktop app, Sally reads these values from its local settings store. The checked-in `.env.example` is only a reference for backend/deployment-related configuration and is not required for the desktop quickstart.

## AI IDE Quickstart

If you're using an AI coding IDE or agent, you can give it the prompt below after cloning the repository locally.

### Suggested Prompt

> Read `README.md` and `docs/architecture.md` fully so you understand the product, architecture, and current codebase before making changes.
>
> Then:
>
> 1. Set up the project locally.
> 2. Install all required dependencies.
> 3. Verify whether the project is fully up to date and working.
> 4. Prefer validating the desktop app first, then the optional backend in `sally-backend/`.
> 5. Run the appropriate checks, builds, and verification steps.
> 6. Flag anything broken, outdated, duplicated, unnecessary, or inconsistent in the setup or codebase.
>
> Important rules:
>
> - Do **not** ask me for API keys, secrets, or credentials during normal setup.
> - Instead, tell me exactly where I should add them in the app UI for the desktop app, or in backend/cloud deployment config when relevant.
> - Do **not** invent missing configuration values.
> - Do **not** deploy anything automatically.
> - If backend deployment is relevant, inspect `sally-backend/` first and then ask me whether I want you to deploy it to Google Cloud Run.
> - If I say yes, collect only the required deployment details from me, prepare the Cloud Run setup, and execute it only after confirmation.
>
> Focus on:
>
> - getting the desktop app working end to end
> - verifying local setup
> - checking for stale docs or broken scripts
> - confirming the backend setup path if needed
> - keeping the repo clean

## Automated Cloud Deployment

For hackathon judging: this repository includes an automated cloud deployment path for the Sally Vision Backend, and the deployment code is checked into this public repo.

Deployment automation files:
- `sally-backend/cloudbuild.yaml` — Infrastructure/deployment pipeline for Google Cloud Build and Cloud Run
- `sally-backend/deploy.sh` — One-command deployment script for Google Cloud Run
- `sally-backend/Dockerfile` — Container definition used for deployment

To learn more about the cloud deployment verification, watch this [video](https://www.tella.tv/video/sally-backend-2fpq).

Automated deployment option:

```bash
cd sally-backend
gcloud builds submit --config cloudbuild.yaml
```

One-command scripted deployment option:

```bash
cd sally-backend
./deploy.sh
```

What this automates:
- Build the backend container image
- Push the image to Artifact Registry
- Deploy the service to Google Cloud Run
- Inject the Gemini key from Secret Manager at deploy time
- Enable backend writes to Google Cloud Logging

This deployment automation is included directly in the public repository for review.

### Cloud Run Backend Deployment

The Sally Vision Backend runs on Google Cloud Run and proxies Gemini API calls.

The desktop app works without installing `sally-backend/` separately. Use the backend folder only if you want to run or deploy the optional hosted Gemini proxy.

For local backend debugging:

```bash
cd sally-backend
npm install
npm run dev
```

```bash
cd sally-backend

# One-time bootstrap
gcloud services enable secretmanager.googleapis.com
gcloud artifacts repositories create sally \
  --repository-format=docker \
  --location=us-central1 \
  --description="Sally backend images"

# Create the Gemini secret once, or add a new version later
printf '%s' "<your-gemini-api-key>" | \
  gcloud secrets create sally-gemini-api-key --data-file=- \
  || printf '%s' "<your-gemini-api-key>" | gcloud secrets versions add sally-gemini-api-key --data-file=-

# Deploy to Cloud Run (requires gcloud CLI)
./deploy.sh

# Or use the checked-in Cloud Build path:
gcloud builds submit --config cloudbuild.yaml
```

After deploying, copy the Cloud Run URL and paste it into Sally's Settings > Sally Vision Backend URL field.

Cloud Logging note:
- backend logging is enabled only when Cloud Run has `ENABLE_CLOUD_LOGGING=true`
- desktop forwarding is controlled from Settings > `Cloud Logging`
- when both are enabled, desktop events are forwarded to `POST /api/log` and written to the `sally-agent-log` stream

Verification:

```bash
# Check the deployed backend URL and health payload
gcloud run services describe sally-backend --region us-central1 --format="value(status.url)"
curl https://<your-cloud-run-url>/health

# Confirm backend and forwarded desktop logs are arriving
gcloud logging read 'logName:"sally-agent-log"' --limit 20 --format=json
```

## Reproducible Testing Instructions

Follow these steps to verify Sally works end-to-end on your machine.

### Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v20+ ([download](https://nodejs.org/)) |
| **Gemini API Key** | Free from [Google AI Studio](https://aistudio.google.com/apikey) |
| **ElevenLabs API Key** | Free tier from [elevenlabs.io](https://elevenlabs.io/) |
| **Microphone** | Any working mic for voice input |
| **OS** | Windows 10/11 (primary), macOS supported |

Use Node.js 20+ for the full repo. No separate external Chrome or Playwright prerequisite is required for the main Sally browser path.

### Setup (< 3 minutes)

```bash
# 1. Clone and install
git clone https://github.com/manoj7ar/sally.git
cd sally
npm install
npm run verify:desktop

# 2. Start the app
npm run dev

# 3. In the Settings window, add:
# - Gemini API Key
# - ElevenLabs API Key
# - Optional: Sally Vision Backend URL
```

### Test Scenarios

Run these in order to verify all features work:

**Test 1 — Screen Description (Gemini Vision)**
```
Hold Right Alt → say "What am I looking at?" → release
Expected: Sally describes what's currently on your screen
Verifies: Gemini multimodal vision, STT, TTS
```

**Test 2 — Navigation (Sally Browser)**
```
Hold Right Alt → say "Go to Gmail" → release
Expected: Sally browser opens and navigates directly to Gmail or the most relevant Gmail destination
Verifies: Electron browser runtime, navigation resolution, agentic loop
```

**Test 3 — Multi-step Task (Agentic Loop)**
```
Hold Right Alt → say "Search for accessibility tools on Google" → release
Expected: Sally opens search, fills the query, presses Enter, and describes results
Verifies: Multi-step agentic loop with memory, page-context grounding, DOM-first actions
```

**Test 4 — Browser Assistive Help**
```
With a page open in Sally browser: Hold Right Alt → say "What can I do here?" → release
Expected: Sally describes visible controls or actions on the current page
Verifies: DOM/page-context extraction, assistive path
```

**Test 5 — Screen Question**
```
Hold Right Alt → say "How many people are on this page?" → release
Expected: Sally answers from the visible screenshot
Verifies: visual Q&A route, Gemini screenshot understanding
```

**Test 6 — Cancel**
```
During any active task: Hold Right Alt → say "Cancel" → release
Expected: Sally stops immediately and says "Cancelled."
Verifies: Mid-task cancellation
```

**Test 7 — Text Input (Composer)**
```
Click the keyboard icon on the Sally bar → type a command → press Enter
Expected: Same behavior as voice, but via typed text
Verifies: Text-based instruction path
```

### Expected Behavior

- Sally Bar appears at the top of the screen (draggable floating pill)
- Blue border overlay appears when Sally is actively working
- When Sally is waiting for a reply, the browser blurs fully and shows a centered `Agent is waiting for your reply` message with an `End Agent` cancel button
- Every action is narrated aloud via TTS
- The Sally browser keeps its own cookies and sessions across restarts
- Screen-only commands do not open the browser
- The agentic loop runs up to 15 iterations or 3 minutes per task

### Troubleshooting

| Issue | Solution |
|---|---|
| "require is not defined" | Run `npm run build:electron` before `npm run dev` |
| Browser task starts in the wrong place | Retry with a clearer command like `go to Gmail` or `open Canva` |
| No audio / TTS silent | Check ElevenLabs key in Settings, verify speakers are on |
| "Gemini API key" error | Add a key in Settings > AI Model > Gemini API Key, or configure the Sally Vision Backend URL |
| Hotkey not working | Restart the app; on macOS grant Accessibility permission |

Settings note: the current desktop UI exposes Gemini under `AI Model`, with the Voice section covering ElevenLabs and Gemini speech-to-text status plus an auto research toggle for screen questions.

For a full repo health check, run `npm run check`.

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **AI Vision** | **Gemini 2.5 Flash** | Multimodal screen understanding |
| **AI SDK** | **@google/genai** | Google Gen AI SDK for Node.js |
| **Cloud** | **Google Cloud Run** | Serverless backend hosting |
| **Browser** | **Electron BrowserWindow + webContents** | Persistent Sally browser and DOM-first browser control |
| **Desktop** | Electron + React + TypeScript | Cross-platform desktop app |
| **Build** | Vite | Fast frontend bundling |
| **STT** | **Gemini 2.5 Flash** | Speech-to-text transcription |
| **TTS** | ElevenLabs | Neural text-to-speech |
| **Hotkey** | uiohook-napi | Global push-to-talk |

## Repository Structure

Current repo layout after cleanup:
- `electron/` contains the Electron main process, preload bridge, and desktop orchestration.
- `src/` contains the desktop renderer UI.
- `sally-backend/` is the optional Cloud Run Gemini vision backend.
- `shared/` contains cross-process TypeScript types.
- `scripts/` contains repo-level verification helpers.
- `assets/branding/` contains the shared Sally logo asset.
- `config/macos/` contains the macOS packaging entitlements file.
- `docs/architecture.md` contains the detailed architecture write-up.

```text
.
├── electron/              # Electron main process
│   └── main/
│       ├── services/      # Transcription, TTS, Gemini, browser, screenshot services
│       ├── managers/      # API keys, session management, microphone
│       └── utils/         # Constants, store
├── src/                   # Desktop renderer UI (React)
│   └── windows/
│       ├── config/        # Settings window
│       ├── sallyBar/      # Floating assistant bar
│       └── borderOverlay/ # Visual feedback overlay
├── sally-backend/         # Cloud Run backend (Gemini vision proxy)
│   ├── index.js           # Express server with @google/genai SDK
│   ├── Dockerfile         # Cloud Run container config
│   ├── cloudbuild.yaml    # Automated Cloud Build → Cloud Run deployment pipeline
│   └── deploy.sh          # One-command Cloud Run deployment script
├── shared/                # Shared TypeScript types
├── docs/                  # Architecture and supporting documentation
│   └── architecture.md    # Detailed system architecture document
└── README.md
```

## Accessibility Mission

Sally exists because the web demands precise motor control such as clicking, scrolling, typing, dragging, that millions of people struggle with. Whether it's a permanent motor impairment like ALS or cerebral palsy, a temporary injury like a broken wrist, or chronic RSI from years of mouse use, the barrier is the same: the web requires hands that work perfectly.

Sally removes that barrier entirely. One voice command replaces dozens of clicks. The goal is not convenience, it's **independence**.

## Built By

Built by [Manoj7ar](https://github.com/Manoj7ar) for the **Gemini Live Agent Challenge 2026**.
