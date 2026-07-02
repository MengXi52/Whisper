# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**轻语 (Whisper)** — AI写作助手, a Tauri v2 desktop application for AI-assisted novel writing. Supports the full writing lifecycle: ideation → planning → writing → editing.

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + Lucide React
- **Backend**: Rust (Tauri v2) with SQLite (`rusqlite` bundled), `reqwest` for HTTP, SSE streaming
- **LLM**: OpenAI-compatible API with streaming + Function Calling (tool use)

## Commands

```bash
# Install frontend dependencies
npm install

# Run in dev mode (Vite dev server at :1420, then "tauri dev" in another terminal)
npm run dev          # starts Vite dev server
npx tauri dev        # starts Tauri app (builds Rust + opens window)

# Build for production
npx tauri build

# Rust backend checks (from src-tauri/)
cargo check
cargo build
```

There is no test suite and no lint configuration.

## High-Level Architecture

### Communication Flow

```
React UI → Tauri invoke() → Rust #[tauri::command] → SQLite / LLM API
                                                           ↓
React UI ← chat:chunk SSE event ← Rust Emitter ← LLM stream
```

Frontend calls Rust commands via the wrapper functions in `src/utils/tauri.ts`. Rust emits SSE streaming chunks via the `chat:chunk` Tauri event, listened to by `chatStore.initChunkListener()`.

### State Management (Zustand)

Four stores in `src/stores/`:
- **uiStore** — theme (dark/light), current writing phase, sidebar/panel toggle, focus mode, current model name
- **projectStore** — current project, project list, chapters list, current chapter selection
- **chatStore** — conversations list, current conversation, messages, streaming state, skills, active skill IDs. `initChunkListener()` subscribes to `chat:chunk` SSE events from the Rust backend.
- **apiConfigStore** — API configurations (base URL, key, models), default config selection

### Writing Phases

The app has four fixed phases (`WritingPhase`): `ideation` → `planning` → `writing` → `editing`. Each phase has a tailored system prompt built in `src-tauri/src/llm/prompt.rs` via `build_system_prompt()`. The prompt assembles: base role, phase instructions, skill injections, setting card summaries, chapter context, and tool-calling context (conversation_id + project_id).

### Skills System

Skills inject system prompts and tool definitions into the LLM conversation. Built-in skills are initialized in `db.rs:init_builtin_skills()`:
- **古风言情** — classical Chinese romance style
- **悬疑推理** — mystery/detective style

Each skill stores: `system_prompt`, `tools` (JSON array of OpenAI Function Calling definitions), `trigger_scenarios` (JSON array of genre tags).

### LLM Tool Calling

13 tools are defined as Function Calling JSON in `db.rs:init_builtin_skills()` and implemented in `llm/client.rs`. Categories:
- **Chapter tools**: `query_outline`, `query_chapter`, `create_chapter`, `update_chapter`, `delete_chapter`
- **Setting card tools**: `query_setting_cards`, `create_setting_card`, `update_setting_card`, `delete_setting_card`
- **Conversation tools**: `query_conversations`
- **Skill tools**: `list_skills`, `use_skill`

The `stream_chat()` function in `llm/client.rs` handles the tool-calling loop: send messages → LLM returns `tool_calls` → `execute_tools()` dispatches → results appended → re-request LLM → final text content streamed. Max 10 tool rounds.

### Slash Commands (`/tool_name`)

Users can type `/` in chat to trigger tool commands. Frontend (`ChatInput.tsx`) shows a dropdown with all tool names/descriptions. Backend (`chat.rs:parse_slash_command`) detects `/tool_name` and injects a tool-calling instruction into the system prompt. If no skill is active when a slash command is used, `load_all_tools()` loads all built-in tool definitions automatically.

### Database (SQLite)

Stored at `%APPDATA%/Whisper/whisper.db`. Tables: `projects`, `chapters` (tree via `parent_id`, ordered by `sort_order`), `setting_cards` (with version history in `setting_card_versions`), `conversations`, `messages`, `skills`, `api_configs`.

`setting_cards.fields` and `skills.tools`/`trigger_scenarios` are stored as JSON TEXT. `conversations.skill_ids` is stored as JSON TEXT array.

### Export Formats

`commands/export.rs` supports: TXT (single chapter), Markdown (single chapter), DOCX (full project with all chapters). Default export path: `%APPDATA%/Whisper/exports/`.

### Key Conventions

- `@/` path alias maps to `src/` (configured in both `vite.config.ts` and `tsconfig.json`)
- Tailwind uses CSS custom properties for theming (`--color-bg-primary`, `--color-accent`, etc.) — actual color values are in `src/index.css`
- `tauriInvoke<T>()` in `src/utils/tauri.ts` is the generic wrapper for all Tauri `invoke` calls — use it when adding new commands
- Rust `DbState` and `CancellationTokenState` are managed via Tauri State (`Mutex<Connection>` and `Mutex<bool>`)
- `src-tauri/patches/proc-macro2-1.0.106/` contains a vendored patch to force `span-locations` feature and skip build script issues on Windows
- The `src-tauri/rustc-wrapper.sh` script wraps rustc for the proc-macro2 patch

### Adding a New LLM Tool

1. Add Function Calling JSON definition in `db.rs:init_builtin_skills()` (in the `tools` array)
2. Add a match arm in `client.rs:execute_tools()`
3. Implement the `tool_xxx(db, args) -> String` function in `client.rs`
4. Add the tool entry to `ChatInput.tsx` TOOLS array for slash command support
5. Update `docs/tools.md`
