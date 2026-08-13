# pi (earendil-works/pi) — Research Notes

Raw research for a tutorial comparing coding-agent architectures (Claude Code → pi → DeepSeek Harness), focused on "core vs extension" design. All claims are from primary sources (shallow clone of `https://github.com/earendil-works/pi` at `/tmp/pi-repo`, commit `9d2ec7f`, 2026-08-13) unless a second source is named. **This is research, not the tutorial.**

## 1. What pi is (summary)

Pi is a **minimal terminal coding-agent harness** — an open-source (MIT) "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI" (GitHub API description). Its core promise is *extensibility instead of built-in features*: the CLI ships with only four default tools (`read`, `write`, `edit`, `bash`) and deliberately omits sub-agents, plan mode, permission popups, to-dos, background bash, and MCP — all of which can be built as TypeScript extensions or installed as third-party "pi packages". The repo is a npm-workspaces monorepo ("pi-mono") whose packages separate the LLM layer (`pi-ai`), the agent runtime (`pi-agent-core`), the TUI library (`pi-tui`), and the product CLI (`pi-coding-agent`), so the agent loop, the UI, and the provider layer are independently reusable libraries rather than one monolithic binary.

## 2. Facts at a glance (as of the shallow clone, 2026-08-13)

| Fact | Value | Source |
|---|---|---|
| Repo | github.com/earendil-works/pi (default branch `main`) | GitHub API |
| Stars | ~89,561 | GitHub API (`stargazers_count`) |
| License | MIT | `/tmp/pi-repo/LICENSE`, `/tmp/pi-repo/README.md:108` |
| CLI package | `@earendil-works/pi-coding-agent` (npm), current version `0.84.1` | `/tmp/pi-repo/packages/coding-agent/package.json` |
| Workspace root version | `0.0.3` | `/tmp/pi-repo/package.json` |
| Repo description | "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI" | GitHub API |
| Created / last pushed | 2025-08-09 / 2026-08-13 | GitHub API |
| Website / docs | https://pi.dev, docs at https://pi.dev/docs/latest | `/tmp/pi-repo/README.md:23-24` |

Note: the README and AGENTS.md refer to the repo as **pi-mono** in places (e.g. `/tmp/pi-repo/AGENTS.md:123`), and the author (badlogic) publishes public session datasets as `badlogicgames/pi-mono` on Hugging Face (`/tmp/pi-repo/README.md:100-104`). The canonical repo URL is now `earendil-works/pi`.

## 3. Package architecture (exact names, one line each)

All workspace packages live under `packages/` (`/tmp/pi-repo/packages/`). The docs' "Project Structure" section names the classic four (`/tmp/pi-repo/packages/coding-agent/docs/development.md:63-71`):

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```

Complete inventory of the 10 workspace packages (names from each `package.json`):

| Package dir | npm name | One line | Source |
|---|---|---|---|
| `packages/ai` | `@earendil-works/pi-ai` | Unified multi-provider LLM API: providers, model catalogs, auth resolution, token/cost tracking, streaming | `/tmp/pi-repo/packages/ai/package.json`, `/tmp/pi-repo/packages/ai/README.md:3` |
| `packages/agent` | `@earendil-works/pi-agent-core` | Stateful agent runtime with tool calling, event streaming, and session state management | `/tmp/pi-repo/README.md:18`, `/tmp/pi-repo/packages/agent/README.md:3` |
| `packages/tui` | `@earendil-works/pi-tui` | Terminal UI library with differential rendering, editor, Markdown, images | `/tmp/pi-repo/README.md:34`, `/tmp/pi-repo/packages/tui/README.md:3` |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | The product: interactive coding-agent CLI + SDK (sessions, extensions, skills, compaction) | `/tmp/pi-repo/README.md:17` |
| `packages/telemetry` | `@earendil-works/pi-telemetry` | Vendor-neutral telemetry contracts, reference adapter, conformance tests, typed schemas | `/tmp/pi-repo/README.md:30`, `/tmp/pi-repo/packages/telemetry/README.md:3` |
| `packages/client` | `@earendil-works/pi-client` | Transport-neutral client for remote pi sessions over framed CBOR bytes | `/tmp/pi-repo/packages/client/package.json`, `/tmp/pi-repo/packages/client/README.md:3` |
| `packages/protocol` | `@earendil-works/pi-protocol` | Transport-neutral CBOR protocol (v1) for remote pi sessions | `/tmp/pi-repo/packages/protocol/package.json`, `/tmp/pi-repo/packages/protocol/README.md:3` |
| `packages/server` | `@earendil-works/pi-server` | "experimental server package for pi" — session server core (`PiServer`); explicitly unstable | `/tmp/pi-repo/packages/server/package.json`, `/tmp/pi-repo/packages/server/README.md:3-6` |
| `packages/evals` | `@earendil-works/pi-evals` | Behavioral, model-backed evals for pi workflows (adapts a real `AgentSession` to `vitest-evals`) | `/tmp/pi-repo/packages/evals/README.md:3` |
| `packages/session-backends/sqlite-node` | `@earendil-works/pi-session-backend-sqlite-node` | Node sqlite session backend for `pi-agent-core` sessions (kept out of the core to avoid native deps) | `/tmp/pi-repo/packages/session-backends/sqlite-node/package.json`, `/tmp/pi-repo/packages/agent/README.md:11-13` |

The README's "All Packages" table lists only the five published/stable ones: `pi-telemetry`, `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui` (`/tmp/pi-repo/README.md:26-35`). The root build script builds packages in dependency order: tui → telemetry → ai → agent → session-backends/sqlite-node → protocol → client → server → coding-agent (`/tmp/pi-repo/package.json` "build" script).

**Core vs extension split**: `pi-ai` (models) and `pi-agent-core` (loop) are model- and UI-agnostic libraries; `pi-coding-agent` is the only package that knows about sessions-as-JSONL, the built-in file tools, the system prompt assembly, and extensions. `pi-tui` is a standalone UI framework that other CLIs could reuse. `client`/`protocol`/`server` are the remote-session path (used by the server, wired through `packages/coding-agent/src/server/create-harness.ts`).

## 4. The agent loop

Two layers exist:

- **Low-level loop** — `agentLoop()` / `agentLoopContinue()` in `@earendil-works/pi-agent-core` (`/tmp/pi-repo/packages/agent/README.md:475-509`). It is an async generator of events (`agent_start`, `turn_start`, `message_start/update/end`, `tool_execution_start/update/end`, `turn_end`, `agent_end`) and accepts a `convertToLlm` + `transformContext` pipeline plus a `streamFn` (`/tmp/pi-repo/packages/agent/README.md:55-64`).
- **`Agent` class** — a stateful wrapper over the loop (`/tmp/pi-repo/packages/agent/README.md:27-43`): holds `AgentState { systemPrompt, model, thinkingLevel, tools, messages }`, exposes `prompt()`/`continue()`/`steer()`/`followUp()`, hooks `beforeToolCall` / `afterToolCall` / `shouldStopAfterTurn`, and tool-execution modes `parallel` (default) vs `sequential` (`/tmp/pi-repo/packages/agent/README.md:113-126, 176-243`).

Key loop properties worth citing for a comparison:

- Messages are **`AgentMessage[]` (app-specific, extensible via declaration merging) → `transformContext()` (prune/inject) → `convertToLlm()` (filter to `user`/`assistant`/`toolResult`) → LLM** (`/tmp/pi-repo/packages/agent/README.md:55-64`). The LLM only ever sees three roles; everything else is app-level.
- A "turn" = one LLM call + its tool executions; the loop repeats turns until the model stops calling tools (`/tmp/pi-repo/packages/agent/README.md:88-111`).
- Steering (interrupt mid-run) and follow-up (queued after run) are first-class queue primitives (`/tmp/pi-repo/packages/agent/README.md:337-375`).
- `terminate: true` from a tool/beforeToolCall/afterToolCall can end the loop after a batch (`/tmp/pi-repo/packages/agent/README.md:122-124`).
- The coding-agent product wraps this via `AgentSession` (`packages/coding-agent/src/core/agent-session.ts` — referenced from `/tmp/pi-repo/packages/coding-agent/docs/rpc.md:12-13`) and adds session persistence, retries, auto-compaction, and extension events on top.

There is also an in-repo **design spec for a durable, crash-recoverable agent runtime** — `packages/agent/docs/harness.md` ("AgentHarness — implementation specification"). It models a session as an immutable entry tree + mutable registers + an append-only usage ledger, with each operation's full state stored in a register ("the durable program counter") so recovery is a read, not a journal replay (`/tmp/pi-repo/packages/agent/docs/harness.md:111-137`). Backends: Memory, JSONL, SQLite (`/tmp/pi-repo/packages/agent/docs/harness.md:466-468`). This harness is wired into the experimental server path (`packages/coding-agent/src/server/create-harness.ts`) while the CLI still uses the JSONL `SessionManager` (v3 format); the spec itself says the format-4 code "is unfinished and is replaced in place" (`/tmp/pi-repo/packages/agent/docs/harness.md:496`).

## 5. Session design (vs a monolithic agent)

Sessions are **JSONL files**, one JSON object per line, forming an **in-place tree** via `id`/`parentId` so branching never creates new files (`/tmp/pi-repo/packages/coding-agent/docs/session-format.md:3`):

- Location: `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl` (`session-format.md:8-9`).
- Versions: v1 linear, v2 tree, v3 (current) renamed `hookMessage`→`custom`; older files auto-migrate on load (`session-format.md:21-27`).
- Entry types: `session` (header), `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom` (extension state, NOT in LLM context), `custom_message` (extension content, IN context), `label`, `session_info` (`session-format.md:187-304`).
- Message union `AgentMessage` = user | assistant | toolResult | bashExecution | custom | branchSummary | compactionSummary (`session-format.md:161-172`).
- Context building: `buildContextEntries()` walks leaf→root honoring compaction entries; `buildSessionContext()` converts entries to LLM messages (`session-format.md:320-342`).
- `SessionManager` API (create/open/continueRecent/inMemory/forkFrom/list, append*, branch, buildSessionContext) is exported from `@earendil-works/pi-coding-agent` (`session-format.md:386-438`).

Session UX commands: `/resume`, `/new`, `/name`, `/session`, `/tree`, `/fork`, `/clone`, `/compact`, `/export`, `/share` (`/tmp/pi-repo/packages/coding-agent/docs/usage.md` slash-command table; `/tmp/pi-repo/packages/coding-agent/docs/sessions.md:15-26`). `/tree` navigates the in-file tree and can LLM-summarize the abandoned branch; `/fork`/`/clone` extract branches into new session files.

## 6. Tools

- Tools are defined as `{ name, label, description, parameters: TypeBox schema, execute(toolCallId, params, signal, onUpdate) }` — `AgentTool` in `pi-agent-core` (`/tmp/pi-repo/packages/agent/README.md:403-438`); TypeBox schemas give validation + JSON-serializable definitions, and the same `Tool` type is used at the `pi-ai` layer (`/tmp/pi-repo/packages/ai/README.md:114-121`).
- Errors: **throw** from `execute()`; the agent catches and reports `isError: true` to the model — "Do not return error messages as content" (`/tmp/pi-repo/packages/agent/README.md:440-454`).
- The CLI ships four built-in tools by default: `read`, `write`, `edit`, `bash` (`/tmp/pi-repo/packages/coding-agent/README.md` Quick Start; `/tmp/pi-repo/packages/coding-agent/src/core/system-prompt.ts:81` default `["read", "bash", "edit", "write"]`). Full built-in set in `packages/coding-agent/src/core/tools/`: bash, edit-diff, edit, find, grep, ls, read, write, truncate.
- Extensions register more via `pi.registerTool()` (works at runtime without `/reload`; `pi.getAllTools()` / `pi.setActiveTools()` manage them — `/tmp/pi-repo/packages/coding-agent/docs/extensions.md:1338-1343, 1650-1675`).

## 7. "Behavior in prompt / system prompt as config"

The system prompt is **assembled from configurable parts**, not a hardcoded blob (`/tmp/pi-repo/packages/coding-agent/src/core/system-prompt.ts:8-28`): customPrompt (replaces default), selectedTools, toolSnippets (one-line tool descriptions), promptGuidelines, appendSystemPrompt, cwd, contextFiles (AGENTS.md/CLAUDE.md), skills.

- Context files: pi loads `AGENTS.md` or `CLAUDE.md` from `~/.pi/agent/`, walking up from cwd, and the cwd itself; `AGENTS.override.md` replaces them per directory (`/tmp/pi-repo/packages/coding-agent/docs/usage.md` "Context Files" section).
- System prompt replacement: `.pi/SYSTEM.md` (project) or `~/.pi/agent/SYSTEM.md` (global) replaces the default; `APPEND_SYSTEM.md` appends (`/tmp/pi-repo/packages/coding-agent/docs/usage.md` "System Prompt Files" section).
- Skills are listed in the prompt as XML per the Agent Skills spec, with only name+description always in context (progressive disclosure); the model `read`s the full `SKILL.md` on demand (`/tmp/pi-repo/packages/coding-agent/docs/skills.md` "How Skills Work").
- Extensions can rewrite the system prompt per-turn via the `before_agent_start` event, and can see the same structured `systemPromptOptions` pi itself uses (`/tmp/pi-repo/packages/coding-agent/docs/extensions.md:521-556`).
- The tool section of the prompt ("Available tools", "Guidelines") is generated from which tools are active; a tool only appears when it has a `promptSnippet` (`/tmp/pi-repo/packages/coding-agent/src/core/system-prompt.ts:79-119`).

## 8. Context management (compaction)

Auto-compaction triggers when `contextTokens > contextWindow - reserveTokens` (default reserve 16,384); keeps the most recent `keepRecentTokens` (default 20,000) un-summarized (`/tmp/pi-repo/packages/coding-agent/docs/compaction.md:29-45`). Mechanics:

- Cut at turn boundaries; never at tool results ("they must stay with their tool call"); split turns get two merged summaries (`compaction.md:81-117`).
- A `CompactionEntry` is appended to the session tree with `summary`, `firstKeptEntryId`, `tokensBefore`, and (newer) a materialized `retainedTail` so context can be rebuilt "without walking older entries" (`compaction.md:119-145`; `session-format.md:229-248`). **"Context never reads past a compaction"** — a compaction is a self-contained checkpoint (`/tmp/pi-repo/packages/agent/docs/harness.md:647`).
- Structured summary format: Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context, plus `<read-files>`/`<modified-files>` lists; file tracking accumulates across compactions (`compaction.md:215-253`).
- Branch summarization: navigating `/tree` away from a branch optionally writes a `BranchSummaryEntry` at the target leaf summarizing the abandoned path up to the common ancestor (`compaction.md:148-177`).
- Extensions can intercept (`session_before_compact` / `session_before_tree`), cancel, or provide their own summaries (`compaction.md:271-379`).

## 9. How models are exposed

`@earendil-works/pi-ai` is a **`Models` collection of providers**: a provider owns its model catalog, its auth (env var, stored credential, OAuth), and its stream behavior; requests route to the owning provider (`/tmp/pi-repo/packages/ai/README.md:230-235`). Facts to cite:

- ~30 built-in providers (OpenAI, Anthropic, Google, DeepSeek, OpenRouter, GitHub Copilot, Bedrock, Vertex, ... plus any OpenAI-compatible API like Ollama/vLLM) (`/tmp/pi-repo/packages/ai/README.md:57-91`).
- Unified streaming events: `start`, `text_delta`, `thinking_delta`, `toolcall_delta` (partial JSON args), `done`, `error`; stop reasons `stop|length|toolUse|error|aborted` (`/tmp/pi-repo/packages/ai/README.md:652-671, 882-894`).
- Unified thinking levels `off|minimal|low|medium|high|xhigh|max` mapped per-model via `thinkingLevelMap` (`/tmp/pi-repo/packages/ai/README.md:786-821`; `models.md:257-298`).
- `Models` is also used as a library outside pi: "This library only includes models that support tool calling" (`/tmp/pi-repo/packages/ai/README.md:5`).
- Custom models/providers via `~/.pi/agent/models.json` (`/tmp/pi-repo/packages/coding-agent/docs/models.md:3`); extensions can register providers dynamically with `pi.registerProvider()` (`/tmp/pi-repo/packages/coding-agent/docs/extensions.md:1709-1719`); model catalogs are code-generated (`packages/ai/scripts/generate-models.ts`, per `/tmp/pi-repo/AGENTS.md:27`).

## 10. Modes: TUI vs headless

"Pi runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps" (`/tmp/pi-repo/packages/coding-agent/README.md` intro):

- **Interactive (TUI)** — full terminal app built on `@earendil-works/pi-tui`: messages, editor (with `@` file refs, images, `!`/`!!` shell commands), footer with token/cost/context usage, slash commands, keybindings (`/tmp/pi-repo/packages/coding-agent/docs/usage.md` "Interactive Mode").
- **Print mode** — `pi -p "prompt"` one-shot (AGENTS.md smoke tests use `/tmp/pi-local-release/node/pi -p "Say exactly: ok"`, `/tmp/pi-repo/AGENTS.md:141`).
- **JSON event stream mode** — `pi --mode json` prints all session events as JSON lines to stdout for external UIs (`/tmp/pi-repo/packages/coding-agent/docs/json.md:3-9`).
- **RPC mode** — `pi --mode rpc`, headless JSONL protocol over stdin/stdout (commands in, events out) for embedding in IDEs/apps; strict LF framing (`/tmp/pi-repo/packages/coding-agent/docs/rpc.md:3-24`).
- **SDK** — `createAgentSession({ sessionManager, modelRuntime })` from `@earendil-works/pi-coding-agent` to embed the agent in a Node app (`/tmp/pi-repo/packages/coding-agent/docs/sdk.md:14-33`).

## 11. Extension mechanisms (this is the core of the "core vs extension" story)

Four resource types + a packaging format (`/tmp/pi-repo/packages/coding-agent/docs/index.md:3`):

1. **Extensions** — TypeScript modules loaded via [jiti] (TS without compilation). Auto-discovered from `~/.pi/agent/extensions/*.ts` (global) and `.pi/extensions/*.ts` (project, after trust). They subscribe to events, register tools (`pi.registerTool`), commands (`pi.registerCommand`), shortcuts, CLI flags, providers, custom TUI renderers; can block/mutate tool calls, inject context, replace messages, customize compaction (`/tmp/pi-repo/packages/coding-agent/docs/extensions.md:3-17, 109-135, 154-181`).
2. **Skills** — Agent Skills standard (SKILL.md + scripts), progressive disclosure, `/skill:name` commands (`/tmp/pi-repo/packages/coding-agent/docs/skills.md:3-11`).
3. **Prompt templates** — Markdown files in `prompts/` that expand from `/name` slash commands (`/tmp/pi-repo/packages/coding-agent/docs/prompt-templates.md:3-13`).
4. **Themes** — JSON themes (`/tmp/pi-repo/packages/coding-agent/docs/index.md:57`).

**Pi packages** bundle extensions/skills/prompts/themes and are installable from npm, git, or local paths: `pi install npm:@foo/bar@1.0.0`, `pi install git:github.com/user/repo@v1`; declared in `package.json` under the `pi` key or by conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`) (`/tmp/pi-repo/packages/coding-agent/docs/packages.md:3-5, 116-165`). Security warning: "Pi packages run with full system access. Extensions execute arbitrary code" (`packages.md:20`).

**Event surface** (extension hook points, abbreviated from `/tmp/pi-repo/packages/coding-agent/docs/extensions.md:273-348` lifecycle diagram): `project_trust` → `session_start` → `resources_discover` → `input` (intercept/transform) → `before_agent_start` (inject message / rewrite system prompt) → `agent_start` → per-turn `turn_start`, `context` (mutate messages), `before_provider_headers`, `before_provider_request`, `after_provider_response`, `tool_call` (block), `tool_result` (modify), `turn_end` → `agent_end` → `agent_settled`; plus `session_before_compact`/`session_compact`, `session_before_tree`/`session_tree`, `session_before_switch`, `session_before_fork`, `session_shutdown`, `model_select`, `thinking_level_select`, `user_bash`.

**Hot reload**: extensions in auto-discovered locations can be hot-reloaded with `/reload` (also reloads skills, prompts, themes, context files); `pi -e ./path.ts` temporary extensions are not hot-reloadable (`extensions.md:7`, `1276-1298`).

**Example extensions shipped in-repo** (`/tmp/pi-repo/packages/coding-agent/examples/extensions/`): `subagent/` (spawns separate `pi` processes per agent — "Each subagent runs in a separate `pi` process"), `plan-mode/`, `permission-gate.ts`, `todo.ts`, `interactive-shell.ts` (background bash via tmux), `sandbox/`, `gondolin/` (containerization), `ssh.ts`, `git-checkpoint.ts`, `custom-compaction.ts`, `snake.ts`/`space-invaders.ts`/`tic-tac-toe.ts` (games). The repo dogfoods pi on itself via `.pi/` (extensions, prompts like `wr.md`, skills) (`/tmp/pi-repo/.pi/`).

## 12. Key design-philosophy quotes (verbatim, with file paths)

From `/tmp/pi-repo/packages/coding-agent/README.md` ("## Philosophy"):

> "Pi is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with [extensions](#extensions), [skills](#skills), or installed from third-party [pi packages](#pi-packages). This keeps the core minimal while letting you shape pi to fit how you work."

> "**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), or build an extension that adds MCP support."

> "**No sub-agents.** There's many ways to do this. Spawn pi instances via tmux, or build your own with [extensions](#extensions), or install a package that does it your way."

> "**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements."

> "**No plan mode.** Write plans to files, or build it with [extensions](#extensions), or install a package."

> "**No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions](#extensions)."

> "**No background bash.** Use tmux. Full observability, direct interaction."

From `/tmp/pi-repo/packages/coding-agent/README.md` (intro, same file):

> "Pi is a minimal terminal coding harness. Adapt pi to your workflows, not the other way around, without having to fork and modify pi internals."

From `/tmp/pi-repo/packages/coding-agent/docs/index.md:3`:

> "Pi is a minimal terminal coding harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and pi packages."

From `/tmp/pi-repo/README.md:40` (permissions):

> "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it."

From `/tmp/pi-repo/packages/coding-agent/docs/usage.md:304` (repeated in usage docs):

> "It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages, or use external tools such as containers and tmux."

## 13. What pi cannot do / where its seams end (evidence-based)

- **No permission/sandbox layer in the kernel.** Permissions are explicitly out of scope; the README points to external containerization (Gondolin, Docker, OpenShell) (`/tmp/pi-repo/README.md:38-46`, `packages/coding-agent/docs/containerization.md`). Permission popups are an *extension example* (`examples/extensions/permission-gate.ts`), not a built-in.
- **No MCP server/client in the source.** grep for `@modelcontextprotocol` / `mcpServers` across `packages/*/src` returns nothing; the only "mcp" hits are a Claude-Code OAuth scope string and a comment about "MCP bridges" (`/tmp/pi-repo/packages/ai/src/auth/oauth/anthropic.ts:37`, `/tmp/pi-repo/packages/coding-agent/src/utils/tool-result-images.ts:15`). MCP must be built as an extension.
- **Kernel changes require code changes; extensions only hook, they don't replace.** Extensions subscribe to a fixed event catalog (`extensions.md:273-348`) and can block/modify tool calls and messages, but cannot change loop semantics, the session format, or the tool-execution engine. The agent loop itself lives in `pi-agent-core` source; changing it means editing the packages (per `AGENTS.md` rules, code changes then `npm run check`).
- **Hot-reload is limited.** `/reload` covers extensions in auto-discovered locations plus skills/prompts/themes/context files; temporary `-e` extensions are not hot-reloadable; reload is documented as effectively terminal for the running handler ("treat reload as terminal for that handler") (`extensions.md:7, 1290-1298`).
- **No built-in sub-agent orchestration, plan mode, to-dos, or background bash** — all four are explicitly declined in the Philosophy section; the subagent extension spawns separate `pi` processes, and background bash is "use tmux" (`coding-agent/README.md` Philosophy; `examples/extensions/subagent/README.md:4`).
- **Durability non-goals** (for the in-repo AgentHarness spec, i.e. the durable runtime's stated seams): no exactly-once external effects (hooks must be idempotent), no provider stream resumption (partial streams are process-local, never persisted), one process per session (no multi-writer; enforced by a fenced lease in the SQLite backend), no replication, no durable write history, no deletion as a runtime feature (entries/usage are never deleted; the "precise rewrite" is the sole admin exception) (`/tmp/pi-repo/packages/agent/docs/harness.md:207-215, 567-576`).
- **The durable harness is not yet the CLI's runtime.** The current CLI session layer is the JSONL v3 `SessionManager`; the AgentHarness (Memory/JSONL/SQLite backends) is specified in `packages/agent/docs/harness.md` and currently used by the experimental server path (`packages/coding-agent/src/server/create-harness.ts`), with the spec noting unfinished format-4 code (`harness.md:496`).
- **Trust is a gate, not a policy engine.** Project-local resources (`.pi/`, `.agents/skills`) load only after trust resolution; extensions can own the decision via the `project_trust` event, and non-interactive modes default to `defaultProjectTrust: ask` (`extensions.md:352-367`, `settings.md:16`).
- **"Self extensible" framing:** the README calls pi "our self extensible coding agent" (`/tmp/pi-repo/README.md:15`) — i.e., pi is used to extend pi; there is no separate plugin runtime or plugin hot-loading ABI beyond the extension loader.

## 14. Corroboration via yamsfeer/learning-pi-agent (secondary, used only to cross-check)

Cloned to `/tmp/pi-learning` (shallow). It is a Chinese-language study-notes repo about pi ("pi-mono") whose own README summarizes: "Claude Code 是'给你一个 AI 助手'，pi 是'给你造 AI 助手的工厂'" ("Claude Code gives you an AI assistant; pi is a factory for building AI assistants") (`/tmp/pi-learning/README.md`). Its 7-package list (`pi-ai`, `pi-tui`, `pi-agent-core`, `pi-coding-agent`, `pi-web-ui`, `pi-mom`, `pi-pods`) (`/tmp/pi-learning/README.md` "7 个包速览") **does not match the current monorepo** — `pi-web-ui`, `pi-mom`, `pi-pods` no longer exist (they were the old separate `pi-chat`/Slack/pods projects; the current repo has `client`/`protocol`/`server`/`evals`/`telemetry`/`session-backends` instead). It also references the repo as `badlogic/pi-mono`. Treat its architecture notes (e.g. notes/02, notes/03 on the extension system) as corroboration of the general "minimal core + hooks + extensions" shape only; **all claims in this document come from `/tmp/pi-repo`**.

## 15. Key files (paths for citation)

- `/tmp/pi-repo/README.md` — project home, package table, permissions, license (MIT), supply-chain notes.
- `/tmp/pi-repo/AGENTS.md` — development rules; also evidence pi dogfoods itself (release smoke tests, tmux TUI tests).
- `/tmp/pi-repo/packages/coding-agent/README.md` — product intro + **Philosophy** section (the "No X" list).
- `/tmp/pi-repo/packages/coding-agent/docs/index.md` — docs index; extension-stack summary.
- `/tmp/pi-repo/packages/coding-agent/docs/development.md` — project structure (the 4-package diagram), forking/rebranding.
- `/tmp/pi-repo/packages/coding-agent/docs/extensions.md` — the extension API + full event catalog.
- `/tmp/pi-repo/packages/coding-agent/docs/packages.md` — pi packages (install from npm/git/local, manifest).
- `/tmp/pi-repo/packages/coding-agent/docs/skills.md`, `prompt-templates.md`, `themes.md`, `models.md` — resource types.
- `/tmp/pi-repo/packages/coding-agent/docs/session-format.md`, `sessions.md` — JSONL session tree + SessionManager API.
- `/tmp/pi-repo/packages/coding-agent/docs/compaction.md` — compaction + branch summarization.
- `/tmp/pi-repo/packages/coding-agent/docs/usage.md`, `json.md`, `rpc.md`, `sdk.md`, `settings.md` — modes.
- `/tmp/pi-repo/packages/agent/README.md` — agent loop, events, tools, Agent/agentLoop API.
- `/tmp/pi-repo/packages/agent/docs/harness.md` — durable-runtime spec (three stores, operation state machine, backends).
- `/tmp/pi-repo/packages/ai/README.md` — unified LLM API, providers, tools, thinking, auth.
- `/tmp/pi-repo/packages/coding-agent/src/core/system-prompt.ts` — system prompt assembly.
- `/tmp/pi-repo/packages/coding-agent/src/core/tools/` — built-in tools (bash, read, write, edit, grep, find, ls, edit-diff, truncate).
- `/tmp/pi-repo/packages/coding-agent/examples/extensions/` — the "missing features as extensions" example gallery (subagent, plan-mode, permission-gate, sandbox, gondolin, ssh, ...).
- `/tmp/pi-repo/packages/{telemetry,client,protocol,server,evals,session-backends/sqlite-node}/README.md` — peripheral packages.
