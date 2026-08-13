# From Claude Code to DeepSeek Harness

## A tutorial on the plugin runtime kernel, and what "everything is a plugin" actually means

*Audience: someone who lives inside Claude Code (or another agentic coding tool), spends real money on it every day, and wants to understand the architectural ideas underneath DeepSeek Harness (dsh) — the open-source agent harness from DeepSeek AI — and why its kernel is different from the tools you already know.*

*Companion material: this tutorial was researched against primary sources (the `deepseek-ai/deepseek-harness` repository, the `earendil-works/pi` repository, and Anthropic's official documentation). Sources are cited inline and collected in the [Appendix](#appendix-sources-and-further-reading). Raw research notes live in `notes/`.*

---

## Part 0 — The question this tutorial answers

You use Claude Code daily. You spend ~$300/day on it. It works. So why should you care about a harness named `dsh` that ships from an npm package, and a "plugin runtime kernel" nobody you know talks about?

Because of one question, asked three different ways:

| Tool | The question it answers | Its answer |
|---|---|---|
| Claude Code | "How do I *use* an agent to get work done?" | A polished product: a fixed agent loop + curated tools + permission system, extended through slots Anthropic carved out (hooks, MCP, skills). |
| pi | "How small can an agent *core* be?" | A minimal core (`pi-ai` + `pi-agent-core` libraries) with the product (`pi-coding-agent`) built on top. Behavior lives in prompts and in externalized extension units; you adapt the agent to your workflow without forking its internals. |
| DeepSeek Harness | "What if *every* capability of the agent — including the loop itself — were a plugin?" | A plugin runtime kernel (Cordis) where the model adapter, the tool registry, the session log, and the agent loop are all mounted plugins, so every part is replaceable from configuration — and the agent can even inspect and modify its own running plugin tree. |

The deep difference is **where behavior lives**:

- **Claude Code**: behavior lives in a **closed product kernel**. You extend it through documented surfaces around the kernel, but you cannot change the loop, the permission model, or the tool pipeline without Anthropic shipping it. The kernel is a product boundary.
- **pi**: behavior lives in **the prompt and the extension units** around a deliberately tiny open kernel. You can change almost everything by editing prompts/tools/skills — but the kernel is still *code you extend*, not a runtime you recompose. Adding a new kind of capability means writing TypeScript against pi's APIs; the runtime itself (session handling, tool calling, streaming) is fixed at build time.
- **DeepSeek Harness**: behavior lives in **plugins mounted into a shared runtime context**. The kernel's job is not to *do* agent things, but to *mount, order, wire, and unwind* plugins. Since the agent loop is itself a plugin, recomposing the runtime *is* the extension mechanism. There is "no privileged core to patch" — you extend dsh by mounting a plugin beside the others, and every registration is a reversible effect that unwinds when its plugin unloads.

This tutorial walks that evolution, then spends most of its time on the third column: first **what a plugin is** (Part 3), then the **core plugin runtime kernel** of DeepSeek Harness (Part 5), and finally a **real plugin you can run** — opening the harness to your phone (Part 7).

---

## Part 1 — The baseline: Claude Code

*Not a Claude Code manual — a structural sketch, so we have a shared vocabulary for "product with extension surfaces." All claims cite the official docs (code.claude.com), Anthropic's engineering blog, and the anthropics/claude-code repo; details and URLs are in the Appendix.*

### What it is

Claude Code is Anthropic's agentic coding tool. Its own documentation is explicit about the architecture: *"Claude Code serves as the **agentic harness** around Claude: it provides the tools, context management, and execution environment that turn a language model into a capable coding agent."* The loop is three blended phases — **gather context → take action → verify results** — repeated until done, with the user able to interrupt at any point. Tools fall into five categories: file operations, search, execution (Bash/git/tests), web, and code intelligence (LSP). A permission system decides which operations need human approval, with modes (`default`, `acceptEdits`, `plan`, plus `auto`, `dontAsk`, `bypassPermissions`) changing that policy; rules are "enforced by Claude Code, not by the model." Since 2025 it also ships OS-level **sandboxing** for Bash (macOS Seatbelt; Linux/WSL2 bubblewrap + socat).

It is closed-source. The GitHub repo hosts README, changelog, example hooks, and official plugins — no kernel source; the npm package ships a compiled binary.

### Its extension surfaces

Everything you can do to customize Claude Code goes through a fixed set of *slots*. The docs frame extensions as "a layer on top of the core agentic loop," with a decision map for which part of the loop each plugs into:

- **`CLAUDE.md` memory files** — Markdown instructions in four scopes (managed/user/project/local), loaded at session start. Notably *advisory*: "Claude Code treats them as context, not enforced configuration," and mid-session edits don't apply until `/clear` or restart (prompt-cache architecture).
- **Hooks** — deterministic handlers (shell command, HTTP, MCP call, LLM prompt, or subagent) fired at lifecycle events (`PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, …). They can block, allow, inject context, or rewrite tool *input*. Bounded by design: they "communicate through stdout, stderr, and exit codes only," can't trigger `/` commands or tool calls, `PostToolUse` can't undo an already-executed action, and async hooks can't control the loop. A `PreToolUse` deny fires before any permission-mode check and can't be loosened by switching modes.
- **MCP servers** — add tools, prompts, or resources over the Model Context Protocol. MCP only adds *tools the model can call*: it does not change the loop, permissions, or the model, and MCP tools still go through the normal permission flow.
- **Skills** — `SKILL.md` folders following the Agent Skills open standard, with progressive disclosure (descriptions at session start, content on demand). A skill is *instructions, not code*: "Claude interprets the instructions; outcome can vary" — the docs say if a rule must hold every time, make it a hook.
- **Slash commands** (`.claude/commands/`) — now largely superseded by skills; **subagents** — specialized assistants with their own context window, system prompt, tool allowlist, and permission mode, returning a summary to the parent; **settings** (`.claude/settings.json`, permission rules like `Bash(npm run build)`).
- **Plugins** — the packaging layer: "a bundle of skills, hooks, subagents, and MCP servers packaged as a single installable unit," distributed via marketplaces. A plugin *bundles* the above; it cannot add new permission modes, new hook events, or modify the agent loop.

### Where its seams end

The structural point: **you extend Claude Code around a fixed core, never into it.** Evidence, all from primary sources:

- **The loop is Anthropic's.** You cannot change how a turn is assembled, how context is managed, or how tools execute. The only sanctioned way to get "the same tools, agent loop, and context management" as *your* code is the **Agent SDK** (a separate, open-source library product — not a change to the CLI kernel).
- **You cannot hot-load a new permission model.** The mode set is fixed; you can switch or set defaults, but not define new ones. The `auto` mode classifier and its block thresholds are Anthropic-controlled and "not configurable."
- **Core settings aren't hot-reloaded.** Editing `CLAUDE.md` or output style mid-session doesn't apply until `/clear`/`/compact`/restart; the system prompt itself is Anthropic's ("Core instructions… You never see it").
- **Hooks are deliberately bounded** — no tool-call triggering, no undo, async hooks can't steer, `Stop` hooks force-overridden after 8 consecutive blocks, some events can't be blocked at all.
- **`--bare` mode proves the point**: it starts "without loading hooks, skills, plugins, MCP servers, auto memory, or CLAUDE.md" — the extensions sit *on top of* a fixed core, not inside it.

This is not a criticism — it's a *product design*. Anthropic owns the kernel so they can move fast and keep quality high. The cost is architectural: your extensions are tenants of a landlord's building, and the load-bearing walls are not yours to move.

### The economics (why this tutorial exists)

You spend ~$300/day — far above the official enterprise averages (≈$13 per developer per active day, $150–250/month, <$30/day for 90% of users; a typical single session's token usage in Anthropic's own `/usage` example is ~$0.55 at list rates). You're a power user on API billing, where every turn streams real tokens through your key and agent loops are token-hungry (long context, tool schemas, many steps). Keep that number in mind for the end of this tutorial: **when a tool's kernel is open source, the model API is the only thing you pay for** — and the harness itself can be swapped, forked, or run headless.

---

## Part 2 — pi: the minimal core, behavior externalized

*pi = [earendil-works/pi](https://github.com/earendil-works/pi), the open-source "Pi agent harness" by badlogic — frequently written as "pi-agent" or "pi-mono". A whole generation of open-source coding agents evolved from it.*

### What it is

pi is "a minimal terminal coding harness" — an open-source (MIT) monorepo ("pi-mono", ~89.5k stars as of mid-2026) whose own description is "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI". Its design philosophy, verbatim from the repo:

> "Pi is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with extensions, skills, or installed from third-party pi packages. **This keeps the core minimal** while letting you shape pi to fit how you work."

> "Pi is a minimal terminal coding harness. Adapt pi to your workflows, not the other way around, without having to fork and modify pi internals."

The Philosophy section is a list of deliberately declined features — each one shipped as an *example extension* instead of a kernel feature:

> "**No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support."
> "**No sub-agents.** ... Spawn pi instances via tmux, or build your own with extensions..."
> "**No permission popups.** Run in a container, or build your own confirmation flow with extensions..."
> "**No plan mode.** Write plans to files, or build it with extensions, or install a package."
> "**No built-in to-dos.** They confuse models..."
> "**No background bash.** Use tmux..."

And on permissions, from the root README:

> "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it."

Three sentences define the whole design: **small kernel, external behavior, no built-in policy.**

### The package architecture (verified from the source)

The docs still draw the classic four-package diagram — `ai` (LLM provider abstraction), `agent` (loop + message types), `tui` (terminal UI), `coding-agent` (CLI and interactive mode) — but the current monorepo has **10 workspace packages**:

| Package (npm name) | Role |
|---|---|
| `@earendil-works/pi-ai` | Unified multi-provider LLM API: providers, model catalogs, auth, token/cost tracking, streaming |
| `@earendil-works/pi-agent-core` | Stateful agent runtime: tool calling, event streaming, session state (the loop) |
| `@earendil-works/pi-tui` | Terminal UI library (differential rendering, editor, Markdown) |
| `@earendil-works/pi-coding-agent` | **The product**: interactive CLI + SDK (sessions, built-in tools, prompt assembly, extensions) |
| `@earendil-works/pi-telemetry` | Vendor-neutral telemetry contracts |
| `@earendil-works/pi-client` / `pi-protocol` / `pi-server` | Remote-session path: framed CBOR protocol, client, experimental server |
| `@earendil-works/pi-evals` | Behavioral, model-backed evals |
| `@earendil-works/pi-session-backend-sqlite-node` | SQLite session backend, kept out of the core to avoid native deps |

The crucial split: **`pi-ai` + `pi-agent-core` are reusable, UI-agnostic libraries** (the kernel), while **`pi-coding-agent` is the product** that owns sessions, built-in tools, system-prompt assembly, and the extension loader. The CLI ships only four default tools (`read`, `write`, `edit`, `bash`); the rest of the built-ins are `grep`, `find`, `ls`, `edit-diff`, `truncate`.

### How it thinks about extension

pi's extension units (all in `pi-coding-agent`):

- **Extensions** — TypeScript modules loaded via [jiti] (no compilation), auto-discovered from `~/.pi/agent/extensions/*.ts` and `.pi/extensions/*.ts`. They subscribe to a documented **event catalog** (`input`, `before_agent_start`, `tool_call` (block), `tool_result` (modify), `turn_start`/`turn_end`, `session_before_compact`, …), register tools (`pi.registerTool`), commands, providers, and custom TUI renderers.
- **Skills** — the Agent Skills standard (SKILL.md + scripts), progressive disclosure.
- **Prompt templates** — Markdown expanded from `/name` slash commands.
- **Themes** — JSON UI themes.
- **Pi packages** — a distribution format bundling the above, installed from npm/git/local paths (`pi install npm:...`).

Hot reload exists but is scoped: `/reload` re-loads extensions in auto-discovered locations plus skills/prompts/themes/context files (temporary `-e` extensions are not hot-reloadable).

The repo *dogfoods* this: the in-repo example extensions include `subagent/` (spawns separate `pi` processes), `plan-mode/`, `permission-gate.ts`, `todo.ts`, `interactive-shell.ts` (background bash via tmux), `sandbox/`, `gondolin/` (containerization), `ssh.ts`, `git-checkpoint.ts`. That's the "self extensible coding agent" claim — pi is used to extend pi — with no separate plugin runtime ABI.

Four run modes — interactive (TUI), print/JSON (headless), RPC (process integration), SDK (embedding) — make the core reusable *as a library*.

### Where pi's seams end

- **No permission/sandbox layer in the kernel** — explicit by design; containerization is the answer (Gondolin/Docker/OpenShell).
- **No MCP anywhere in the source** — a grep for `@modelcontextprotocol` across `packages/*/src` returns nothing; MCP must be built as an extension.
- **Extensions hook; they don't replace.** Extensions subscribe to a *fixed* event catalog and can block/modify tool calls and messages, but cannot change loop semantics, the session format, or the tool-execution engine. The loop lives in `pi-agent-core` source; changing it means editing the packages and rebuilding.
- **Hot reload is limited** — `/reload` covers auto-discovered extensions and resource files, is documented as effectively terminal for the running handler, and excludes `-e` temporary extensions.
- **The durable runtime is still a spec** — the crash-recoverable "AgentHarness" (immutable entry tree + registers + usage ledger) is wired into the experimental server path; the CLI still runs on the JSONL v3 `SessionManager`.

So pi answers "how small can a core be?" and wins by keeping the core dumb and everything product-ish out of it. But it still draws a line: **kernel code vs. everything else** — extension = code written against pi's APIs at load time, not behavior mounted into a live runtime. DeepSeek Harness erases that line.

---

## Part 3 — What is a plugin? (plainly)

*The question this tutorial is named for. Everything in Parts 1 and 2 was groundwork; now we define the thing itself, in one paragraph, then unpack it.*

> **A plugin is a function that receives a context (`ctx`) and registers contributions into it — and every contribution is a reversible effect. The kernel's job is to mount that function when its dependencies exist and to unwind everything it registered when it unloads.**

That's the whole definition. Three contract points, each load-bearing:

1. **A plugin receives `ctx`.** It does not import its dependencies; it receives them. `ctx` is a service repository — `ctx.tools`, `ctx.llm`, `ctx.subprocess` — and the plugin asks for the keys it needs (via `inject`) and uses them. No constructor injection, no global singletons, no "call this setup function first."
2. **A plugin registers contributions.** Services, event listeners, tool schemas, prompt sections, routes. Registration is the only verb: a plugin *adds to* the running system; it never *replaces files in* it.
3. **Every contribution is a reversible effect.** `ctx.effect(fn)` runs `fn` and records whatever disposer it returns. Unload runs disposers in reverse order and awaits async ones. This is not cleanup-as-an-afterthought — it is the correctness contract that makes hot reload, patching, and self-modification safe.

### Plugin vs. the words people confuse it with

| Word | Meaning | Example |
|---|---|---|
| **module** | a code file that exports things | `hello.ts` |
| **library** | reusable code you *call* | `pi-ai` (a library) |
| **extension** | code that *hooks* a fixed set of events at load time | a pi extension, a Claude Code hook |
| **plugin** | behavior the *runtime itself* mounts, orders, wires, and unwinds | a dsh plugin, a Cordis plugin |

The difference between "extension" and "plugin" here is where the control lives:

- A **pi extension** subscribes to a fixed event catalog in `pi-coding-agent`. It can block a tool call or rewrite the system prompt, but the *runtime* (loop, session format, tool engine) is fixed at build time; the extension is a guest of code that already exists.
- A **dsh plugin** is *the runtime's native unit*. The loop, the tool registry, the model adapter, and the session log are all themselves plugins. Adding a plugin is not extending the product; it is *recomposing the product*, because the composition **is** the product.

### Why reversibility is the superpower

Because every registration is a reversible effect, three things become *safe* that are dangerous or impossible elsewhere:

- **Hot reload** — edit `cordis.yml`; the loader disposes the old plugin (unwinding its effects) and mounts the new one. A failed candidate rolls back.
- **Per-session composition** — a plugin mounted in an `isolate()` scope belongs to one agent; unloading that agent's scope unwinds only its contributions.
- **Self-modification** — a plugin (or the agent using one) can mount and unmount other plugins in the live process, because the runtime can guarantee teardown.

Keep this one-paragraph definition in mind for Part 5 — the kernel deep-dive is just this contract made precise and typed.

---

## Part 4 — DeepSeek Harness: everything is a plugin

### What it is

From the project README:

> "DeepSeek Harness (`dsh`) is an open-source agent harness developed by DeepSeek AI. It uses an architecture where **everything is a plugin**, and is powered by [Cordis]."

Status: **developer preview**, iterating rapidly — "THERE WILL BE COMPATIBILITY-BREAKING CHANGES."

```sh
npx @deepseek-ai/dsh web        # starts the Web UI at http://127.0.0.1:3080
```

The architecture document states the design contract in one paragraph:

> "Cordis is the framework under dsh: **plugins contribute services, typed events, and reversible effects to a shared context**. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so every part is replaceable from configuration. There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads."

Read that twice. It is the whole tutorial in two sentences.

- **"Every part of the product is a plugin"** — the LLM adapter, the tool registry, the session log, even the agent loop. Not "plugins can add tools": the *loop itself* is a mounted plugin implementing a public `Agent` contract (`ctx.agents`), with `agent-loop` as the default driver — swappable like anything else.
- **"There is no privileged core to patch"** — the kernel's only job is to mount, order, wire, and unwind plugins. There is nothing else to patch, because there is nothing else.
- **"Registrations are effects that unwind"** — loading a plugin is a reversible transaction. Unload it and everything it registered (services, listeners, tools, prompt sections) is removed, in reverse order.

### The layering: profiles → bundles → patches → tree

A running `dsh` is a **plugin tree** composed at boot from ordered layers:

1. **Bundles** — distribution units of Cordis config rows + the code they mount (`dsh-base` first: model adapters, tools, persistence, sandbox/approval policy, settings, credentials; `dsh-web-app` adds the browser; `dsh-headless` is a one-shot runner).
2. **Profiles** — named compositions (`web`, `headless` ship as templates) that list which bundles to stack plus the user's own `cordis.patch.yml`.
3. **Patches** — YAML overlays that replace a row's whole `config` by `id`, or insert new rows. Applied in order: bundles → profile patch → home-level patch → `--patch` overlay.

You can inspect the exact tree your machine boots:

```sh
dsh --profile web --dump-config     # prints every plugin row
```

Any row it prints can be replaced by a patch of your own. The config file is the composition; the code is the plugins; and because config rows are *data*, they can be generated, patched, diffed, and hot-reloaded.

### What the shipped composition actually looks like

`packages/bundle/base/cordis.patch.yml` is the shared core of every profile. A real excerpt (row `id`, plugin `name`, optional `config`):

```yaml
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
    - id: hmr
      name: '@deepseek-ai/cordis-plugin-hmr'
      config:
        root: ['.']
    - id: llm
      name: '@deepseek-ai/dsh-llm'
    - id: session
      name: '@deepseek-ai/dsh-session'
    - id: agent
      name: '@deepseek-ai/dsh-agent'
    # ... dozens more rows ...
```

Note the comment in that file: *"Row order carries no load semantics (activation is service-availability driven); the grouping is for readers."* That is the kernel's signature move — **order doesn't matter, dependencies do**. We'll see why in Part 5.

### The core packages (the "spine")

| Package | Owns | `ctx` key |
|---|---|---|
| `core/session` | The append-only `SessionEvent` log and in-memory store — the single source of truth | `ctx.sessions` |
| `core/system-prompt` | Prompt-section and tool-schema assembly | `ctx.systemPrompt` |
| `core/tools` | The scoped tool registry and guarded execution pipeline | `ctx.tools` |
| `core/agent` | The `Agent` interface, live registry, and `agent/*` events | `ctx.agents` |
| `core/agent-loop` | The default driver implementing that interface | `ctx.agentLoop` |
| `llm/llm` | Message/stream vocabulary plus the adapter seam | `ctx.llm` |

A **step** is one model request plus the tools it calls; a **turn** is zero or more steps. The durable conversation record is an append-only **session event log**: "Model-visible means logged. Anything that reaches a model request must be reconstructable from the log." Fork, resume, transcripts, telemetry, and persistence all derive from that one stream.

---

## Part 5 — The core plugin runtime kernel (the deep dive)

*This is the part the tutorial is named for. Everything below is verified against the vendored Cordis source at `vendor/cordis/src/` and the official docs (`docs/cordis-primer.md`, `docs/cordis-tutorial/`).*

### 5.0 Size and shape

The entire kernel is **~2,700 lines of TypeScript** across 8 files in `vendor/cordis/src/`:

| File | Lines | Owns |
|---|---|---|
| `context.ts` | 146 | The `Context` (proxy-based service repository) |
| `service.ts` | 115 | The `Service` base class (provide/inject/intercept) |
| `events.ts` | 352 | The event bus: `emit`, `parallel`, `serial`, `bail`, `waterfall` |
| `registry.ts` | 337 | Plugin shapes, `inject` declaration, runtime records |
| `reflect.ts` | 418 | The service-resolution proxy (`ctx.get`/`ctx.provide`) |
| `fiber.ts` | 754 | The plugin lifecycle: fibers, effects, disposal |
| `logger.ts` | 270 | Logging service |
| `utils.ts` | 287 | Symbol keys, disposables, error composition |

DHS vendors this framework (pinned, patchable, auditable — renamed to the `@deepseek-ai` scope) precisely so the harness **owns its own kernel**: it is the foundation layer, fully under the project's control. The framework's design is described in the Cordis paper, *A Programming Paradigm for Spatiotemporal Composability*.

### 5.1 The five ideas

From the official primer, Cordis in five ideas:

1. **A plugin is an object that implements Service.** It can be a plain function with optional `inject` and `apply(ctx)` fields, or a `Service` subclass whose lifecycle Cordis mounts into the current context.
2. **A context is a repository of services.** A service claims a stable `ctx.<key>` such as `ctx.tools`, `ctx.llm`, or `ctx.sessions`; other plugins find services *by key* instead of importing a concrete implementation.
3. **Declare service dependency via `inject`.** A plugin that names required services *waits* until those services exist, so load order is expressed through service requirements rather than manual boot sequencing.
4. **Typed Events for communication.** Services declare event names and dispatch them as `emit`, `waterfall`, `parallel`, or `serial` depending on whether listeners observe, wrap, fan out, or run in order.
5. **Registrations are reversible effects.** Prompt sections, tool schemas, adapters, providers, and listeners are installed through `ctx.effect()` or `ctx.on()` so reload and teardown unwind them predictably.

The rest of Part 5 unpacks each idea with real code.

### 5.2 A plugin is a function

The official tutorial's first plugin (a file `hello.ts`):

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

Composed by a config file `cordis.yml`:

```yaml
- name: './hello.ts'
```

The loader reads the YAML, resolves the module, and mounts it. That's it — there is no framework bootstrap code in the plugin. Three shapes are accepted:

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin.
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (registered on `ctx` under a name).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

A plugin that *fails* to load is a loud failure, not a skipped entry — misconfiguration fails loud.

### 5.3 The context: a proxy that resolves services by key

The `Context` is the hub. In the source (`context.ts`) the concrete class is wrapped in a `Proxy` at construction:

```ts
constructor() {
  ...
  const self = new Proxy<this>(this, ReflectService.handler)
  this.root = self
  ...
  this.reflect = new ReflectService(self)
  this.registry = new RegistryService(self)
  this.events = new EventsService(self)
  this.logger = new LoggerService(self)
  ...
}
```

Normal property reads on `ctx` go through the service resolver — `ctx.tools` doesn't read a field, it *resolves a service named "tools"*, with all the machinery that implies (availability checks, isolation scopes, intercept config, error messages). Three context operations create *child contexts* without mutating the parent:

- `ctx.extend(meta)` — a child context inheriting the parent's properties plus metadata (used per-plugin).
- `ctx.isolate(name, label?)` — a child context where service `name` resolves in an independent scope, so one implementation can be provided without affecting the parent scope. **This is the primitive that gives one process many differently-composed agents.**
- `ctx.intercept(name, config)` — a child context where plugins loaded below it see `config` merged into that service's resolved config.

### 5.4 Services and `inject`

A **service** is a named API on `ctx`. The `Service` base class (`service.ts`) does two things in its constructor: records itself under a name, and registers it with the reflection layer:

```ts
constructor(protected ctx: Context, name: string) {
  ...
  self.ctx.reflect.provide(name, self, this[symbols.check])
  return self
}
```

`ctx.reflect.provide(name, value, check?)` is how a service becomes available — and it is automatically removed when the owning fiber unloads.

**Dependency is declared, not sequenced.** A plugin's `inject` field names required services:

```ts
export const plugin = {
  inject: ['tools', 'llm'],       // only loads once both exist
  apply(ctx) { ... },
}
```

The fiber stays in `PENDING` until every injected service is provided, then transitions to `LOADING` and runs `apply`. This is why the base bundle's comment says row order carries no load semantics: **the graph, not the file, decides the order.** Intercept config can ride along (object form): `inject: { tools: { /* config merged for this plugin */ } }`.

### 5.5 Events: five dispatch modes

`events.ts` implements the event bus with five dispatch modes — the extension seam for interception and policy:

| Mode | Awaited? | Order | Return value | Use |
|---|---|---|---|---|
| `emit` | No | registration order | No | observers (log, telemetry) |
| `parallel` | Yes | all at once | No | fan-out of independent work |
| `serial` | Yes | registration order | First bail value | first-wins decisions |
| `bail` | No | registration order | First bail value | synchronous veto chains |
| `waterfall` | No | registration order | Yes | around-middleware: wrap, mutate, replace, or short-circuit |

The **waterfall** is the powerful one, and its semantics are precise (from the primer):

> "`ctx.waterfall` is around-middleware. A listener receives `(...args, next)`. Call `next()` to delegate the possibly wrapped result to the next service; return without `next()` to short-circuit. Values propagate through `next()`'s return value."

In the source, the chain is composed around the innermost `next`:

```ts
waterfall(...args: any[]) {
  const cbs = this.dispatch('waterfall', args)
  const inner = args.pop()          // the innermost (built-in) behavior
  const next = () => {
    const cb = cbs.shift() ?? inner // next listener, or the built-in
    return cb(...args)
  }
  args.push(next)
  return next()                     // outermost-first
}
```

A policy listener can *veto* by simply not calling `next()`; an annotating listener must delegate. The harness's turn flow uses waterfalls exactly this way: `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are all waterfalls whose listeners must call `next()` to delegate; `agent/turn-stopping` is serial with no `next()`.

Listeners are registered with `ctx.on(name, listener)` / `ctx.once(...)` and are **owned by the calling fiber** — unloaded automatically when it unloads. Dispatch also applies *context filtering*: listeners registered in one isolated scope only see events dispatched from that scope (`hook.global` opts out).

### 5.6 Fibers and reversible effects (the lifecycle)

The `Fiber` is the runtime instance of one plugin application — "a fiber tracks dependency state, validated config, lifecycle effects, and cleanup." Lifecycle states (`fiber.ts`):

```
PENDING → LOADING → ACTIVE → (FAILED)
               ↘ UNLOADING → DISPOSED
```

- `PENDING` — waiting for required services.
- `LOADING` — the plugin callback is running.
- `ACTIVE` — loaded and providing.
- `FAILED` — the callback or its config threw.
- `UNLOADING` — disposers are running.
- `DISPOSED` — removed and cannot restart.

Every registration is an **effect**. `ctx.effect(fn)` runs `fn`, and whatever disposer `fn` returns is recorded; on unload, disposers run **in reverse registration order**, and async disposers are awaited. Listeners (`ctx.on`) are implemented *as effects* — `EventsService.register` calls `this.ctx.fiber.effect(...)` — which is why unload cleans up everything automatically:

```ts
register(label, hooks, callback, options) {
  return this.ctx.fiber.effect(() => {
    hooks[options.prepend ? 'unshift' : 'push']({ ctx: this.ctx, callback, ...options })
    return () => this.unregister(hooks, callback)   // the disposer
  }, label)
}
```

This is the design rule DHS repeats everywhere: **"Registrations are effects"** — every contribution goes through `ctx.effect()` / `ctx.on()`, and a registry's `register()` returns the disposer. The harness even *hardened* this in its vendored fork (documented local modification: reentrant disposal gaps closed, effect creation rejected while the owner is `UNLOADING`, etc.). Reversibility is a first-class correctness property, not a cleanup nicety.

### 5.7 Composition: config → loader → tree → hot reload

The **Loader** (`@deepseek-ai/cordis-plugin-loader`) owns an entry tree: it imports plugin modules by `name`, applies their `config`, and keeps the running plugin graph in sync with entry updates. Entry options: `id`, `name`, `config`, `group` (a nested entry list), `disabled`, `inject`. Its API (`loader.create / update / remove / resolve / await`) is the runtime face of composition.

The **Include** plugin turns a `cordis.yml` file into that tree — this is what your `dsh` boots from. The file is a *list of plugin entries*; `!!js` expressions in `config` are evaluated lazily (after injections activate) so config can be computed from live services. Patches target a row by `id` and replace its *whole* `config`.

The **HMR** plugin watches config files and re-mounts changed trees live. Combined with patches, this means: **the composition is hot-editable.** Edit a `cordis.yml` (or apply a patch), and the running tree reconciles — plugins that changed are disposed and re-created transactionally (the vendored fork added transactional reconciliation: if a candidate application fails, the previous plugin/config is restored).

### 5.8 The mental model

If you take one thing from Part 5:

> **The kernel doesn't do agent things. It mounts, orders, wires, and unwinds plugins. Everything agent-shaped — models, tools, memory, the loop — is a plugin that some other plugin can replace, wrap, or veto, and every registration is a reversible effect.**

That one sentence explains every "wow" in Part 6.

---

## Part 6 — What DeepSeek Harness can do when others cannot

*Each item below is a documented capability, with the primary-source hook. These are the concrete answers to "what can dsh do that Claude Code / pi can't."*

### 6.1 The agent modifies its own running runtime (self-modification)

The flagship demo (`examples/web-cordis`, `pnpm run demo:cordis`): a **self-referential agent** that can inspect and change its in-memory Cordis plugin tree. It exposes five model-facing tools (`@deepseek-ai/dsh-tool-cordis`):

- `cordis_inspect` — read-only report over the current process: services, live plugin fibers, registered tools, this session's dynamic packages.
- `cordis_define` — record a new plugin package (host half + optional browser half) after syntax-checking; nothing runs yet.
- `cordis_run` — evaluate the host half in a sandboxed VM and deliver the browser half to every open web page.
- `cordis_stop` — dispose the host half and withdraw the browser half; the definition survives.
- `cordis_undefine` — stop and forget the definition.

Consequences, straight from the tool's README:

> "Dynamic packages live only in the shared DSH process memory. They remain active across later turns and may affect other sessions in that process, but disappear after `cordis_stop`/`cordis_undefine`, toolset unload, or DSH restart. They create no Plugin file, install no package, change no `cordis.yml`... To keep an experiment, ask the Agent to implement a normal local, project, or repository Plugin through the regular development workflow."

So: an agent can, mid-conversation, **invent a capability, mount it, use it, and unmount it** — with no rebuild, no restart, no product release. Claude Code and pi have nothing equivalent: you cannot hot-mount new *runtime* behavior into either from inside a session (Claude Code's MCP/skills require setup outside the loop; pi's extensions are loaded at startup — the `/reload` hot path covers only auto-discovered extension files and resources, and doesn't give the agent tools to author and mount plugins about its own live runtime). The honest caveat, also from the README: the sandbox "isolates globals but is not a security boundary... Treat this toolset like bash access" — self-modification is powerful and therefore dangerous by design.

> **Meta-note:** this tutorial is being written *inside* DSH, using exactly this machinery — the session you're reading runs on the harness, and its agent holds `cordis_inspect`/`cordis_define`-class tools over the live process. The kernel Part 5 describes is running underneath this conversation right now.

### 6.2 One process, many differently-composed agents (per-session presets)

An **agent preset** is a directory with one `agent.cordis.yml`. Mounting it under an agent's *scoped context* gives that session its own tools and prompt sections **while every other live session keeps its own** — so one process runs several differently-composed agents at once: different tool sets, different persona, different prompt sections.

The composition split is deliberate:

- **Host composition** — registries and cross-session facilities (persistence, sandbox/approval stack, model route, subagent registry): process singletons, shared.
- **Agent preset** — what *one session* contributes to those registries: its tools, persona, prompt sections.

A preset that names a row publishing a process-global service is *rejected at mount* rather than allowed to collide with the next session. This is `ctx.isolate()` from Part 5 made product-shaped: isolation is a kernel primitive, so multi-tenancy of agent identities is a configuration matter, not a fork.

### 6.3 Everything is a swappable seam — including bash, the model, and subagents

A **capability seam** has three roles: a **Service Definition** (the interface), a **Service Provider** (the implementation), and a **Consumer** (usually a model-facing tool). Seams are why "one provider swap changes the whole product": filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks. Subagent providers vary "from a fresh child agent to a delegated turn in another product" behind one interface.

The architecture doc's extension map is the practical answer to "where does new behavior go":

| Goal | Mechanism |
|---|---|
| Add a model provider | register its adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools` |
| Give one session a different capability set | compose an agent preset |
| Add shell execution | register a `ctx.shell` backend |
| Add a human command | register on `ctx.commands` (no model turn) |
| Add background work | register on `ctx.jobs` |
| Add filesystem access or policy | register a `ctx.fs` provider / listen to `fs/*` |
| Confine spawned processes | use a `ctx.sandbox` backend |
| Intercept a request, tool, or turn | use `agent/*` or `tools/*` events |
| Add model-facing context | call `agent.inject()` |
| Add durable session state | extend `SessionEventMap` |

No mechanism in that table is "fork the harness." In Claude Code, "add a model provider" is not on the table at all; in pi it means writing a TypeScript provider against `pi-ai` and rebuilding.

### 6.4 Live reconfiguration, hot reload, and policy-as-plugin

- `cordis.yml` edits / patch overlays reconcile the **running** tree (HMR), transactionally — a failed candidate application rolls back to the previous state.
- **Policy is a plugin too.** Approval and permission behavior mount from config. (This session's approval policy was switched from `ask` to `never` — a live policy change in the plugin tree, no rebuild. The same lever controls sandbox policy, subagent backends, etc.)
- `dsh --dump-config` prints the exact tree your machine boots; any row is patchable by you.

### 6.5 The session log as single source of truth

Everything the model sees is logged as a durable session event; history, forks, resumes, transcripts, telemetry all derive from the one stream. "A new model-visible input requires a new session event" is an enforced invariant, and replay fidelity is preserved (raw `assistant/chunk` events). This makes sessions **forkable and replayable by construction** — properties that pi has in spirit (sessions/compaction/branching) but that are kernel-level in dsh.

### 6.6 Open kernel + your model key = a different cost curve

dsh is MIT-licensed and open source; you bring your own DeepSeek (or any provider registered on `ctx.llm`) API key. The $300/day problem decomposes differently here: the harness is free, replaceable, and auditable; you pay for *model tokens*, and you can run it headless, in CI, or as a library (examples ship: `headless-agent`, `jsonrpc-agent` + Python SDK, `acp-agent` automation server). Whether that saves *you* money depends on your workload — the architectural point is that the cost of the *product layer* is zero and swappable, which no closed product can offer.

### 6.7 Honest limitations (so the tutorial stays credible)

- **Developer preview**: "THERE WILL BE COMPATIBILITY-BREAKING CHANGES." APIs and config formats are still moving.
- **Young ecosystem**: fewer skills/plugins/MCP integrations than Claude Code's marketplace today.
- **Self-modification is not a security boundary**: dynamic plugins can reach live capabilities; treat it like shell access.
- **Model quality is the product**: dsh doesn't ship a model — the harness is only as good as the model you route through `ctx.llm`. Claude Code's curated model/loop integration is a real product advantage for most users.

---

## Part 7 — A real plugin: run dsh from your phone

*The concrete plugin this tutorial has been building toward. Full code lives in this repo at `examples/mobile-remote/` — read it alongside this chapter.*

### The honest starting point: you may not need a plugin at all

`npx @deepseek-ai/dsh web` already serves a **full web application** at `http://127.0.0.1:3080`. It renders in a phone browser. The only thing missing is a *route* from your phone to the machine. Three options:

| Option | Effort | Security | When |
|---|---|---|---|
| **cloudflared quick tunnel** (this plugin) | zero config, any network | public URL — anyone with the link can drive the harness; rely on dsh's approval policy | anywhere, including cellular |
| **Tailscale** (no plugin) | install on laptop + phone | private tailnet, encrypted; patch `webserver.host` to `0.0.0.0` | you want privacy |
| **LAN** (no plugin) | same Wi-Fi only | your network's trust | quick testing at home |

So "can a plugin let me run the harness on my phone?" — the *capability* needs no plugin; the plugin is what makes the public path **turnkey and observable**. That distinction is itself a lesson: in dsh, the composition is the product, so a plugin is how you package a *workflow*, not how you bolt on a missing feature.

### What the plugin does

`examples/mobile-remote/src/index.ts` — written against the real, live service contracts (`SubprocessSpawnSpec`, `WebRoute`):

1. **Spawns a managed tunnel.** `ctx.subprocess.spawn({ argv: ['cloudflared', 'tunnel', '--url', 'http://127.0.0.1:3080', ...], ... })` — cloudflared quick tunnels need no account and work on any network.
2. **Watches for the published URL.** cloudflared prints `https://<random>.trycloudflare.com` on stderr; the plugin scans for it and logs "phone URL: …".
3. **Serves its own status route.** `ctx.webServer.register({ kind: 'exact', path: '/mobile-remote', ... })` returns `{ status, localUrl, publicUrl }` as JSON — reachable from the phone *through the same tunnel*.
4. **Unwinds on unload.** The whole capability is one `ctx.effect(...)` whose disposer calls `handle.terminate()` and awaits real process-tree exit. Stop the plugin, the tunnel dies with it.

### The "what is a plugin" tour of the code

```ts
export const name = 'mobile-remote'          // 1. a named plugin
export const Config = { port: 3080, tunnel: 'cloudflared', ... } // validated config

export function apply(ctx: Context, config: Config) {
  const webServer = ctx.get('webServer')     // 2. optional service by KEY, not import

  if (config.tunnel === 'cloudflared') {
    ctx.effect(() => {                       // 3. ONE reversible effect = the capability
      const handle = ctx.subprocess.spawn({ /* argv, cwd, stdio, graceMs */ })
      handle.stderr?.on('data', chunk => { /* parse trycloudflare.com URL */ })
      handle.done.catch(error => logger.warn(...))
      return async () => {                   //    disposer: kill the tunnel, await exit
        handle.terminate()
        await handle.waitForExit()
      }
    })
  }

  if (webServer) webServer.register({ kind: 'exact', path: '/mobile-remote', handler })
}
```

Every line maps to Part 3's contract: receives `ctx` (never imports services), registers contributions (`ctx.effect`, `ctx.webServer.register`), and every contribution is reversible (the disposer). Mounted by one patch row (`examples/mobile-remote/cordis.patch.yml`):

```yaml
- insert:
    - id: mobile-remote
      name: '/absolute/path/to/examples/mobile-remote/src/index.ts'
      config:
        port: 3080
        tunnel: cloudflared
```

One subtle kernel fact, verified from the harness source: a `--patch` overlay's `name` resolves against the **profile's** config directory (`$DSH_HOME/profiles/<name>/`), not against the patch file — so local plugins use an **absolute path** (absolute names become file URLs), or a package name once published, or a `./` path if the file sits in the profile dir. That asymmetry is exactly the kind of thing you learn by reading `mountRootInclude` in `packages/boot/app-boot/`.

Run it:

```sh
dsh web --patch examples/mobile-remote/cordis.patch.yml
# log: mobile-remote: phone URL: https://<random>.trycloudflare.com
```

Open that URL on your phone. `curl .../mobile-remote` returns the live status JSON.

### The elegant part is what it *didn't* need

- **No changes to the harness.** No fork, no rebuild, no new permission mode, no Anthropic release. In Claude Code terms this would be an impossible request ("add a managed tunnel process and a status endpoint to the product"); here it is one file and one config row.
- **No privileged core touched.** `subprocess` and `webServer` are just two more services; the plugin is a peer of the agent loop, not a patch to it.
- **Honest caveats** (also in the example's README): quick tunnels are *public* — anyone with the URL can drive the harness while it's up, so keep approval policy strict; the example is a teaching artifact, not a published bundle (publishing uses dsh's bundle system, `docs/user/develop/basic/`); and the code follows the live contracts but wasn't end-to-end tested against a real cloudflared binary here.

---

## Part 8 — Side by side

| Dimension | Claude Code | pi | DeepSeek Harness |
|---|---|---|---|
| Kernel | Closed product kernel (Anthropic's) | Tiny open kernel (`pi-ai` + `pi-agent-core` libraries) | Plugin runtime kernel (Cordis, ~2.7k lines) |
| "Everything is a plugin"? | No — fixed loop + extension slots | No — kernel is code you extend | **Yes — loop itself is a plugin** |
| Extension unit | Hooks, MCP, skills, slash commands, subagents | TS extensions, skills, prompt templates, themes, Pi Packages | **Plugins mounted into a shared context** |
| Change the agent loop? | No | Fork the code | **Replace the `agent-loop` plugin / mount a new driver** |
| Hot-reload behavior at runtime | No | Limited — `/reload` for auto-discovered extensions/resources | **Yes — HMR + patch overlays reconcile the live tree** |
| Agent modifies its own runtime | No | No (self-extensible = extending via its own tools) | **Yes — `cordis_*` tools over the live process** |
| Per-session agent composition | Subagent definitions only | No | **Agent presets via `isolate` scopes** |
| Policy (permissions/sandbox) | Built into product | Deliberately absent (containerize) | **Plugins — swappable from config** |
| Model providers | Anthropic-managed set (+ gateways) | ~30 providers via `pi-ai`, incl. DeepSeek | **Any provider registered on `ctx.llm`** |
| Durable conversation source | Session transcripts | JSONL session tree + compaction | **Append-only event log; model-visible ⟺ logged** |
| License | Proprietary | MIT | **MIT, open source** |
| Cost structure | Product + per-token billing | Free harness + your model key | **Free harness + your model key** |
| Maturity | Very high | High | Developer preview, fast-moving |

The one-row summary: **Claude Code is a product with extension surfaces; pi is a minimal library with externalized behavior; dsh is a runtime where the composition is the product.**

---

## Part 9 — Hands-on learning path (from zero to kernel)

If you want to *feel* the kernel, in this order:

1. **Run the official Cordis tutorial** — `docs/cordis-tutorial/` in the repo, 7 chapters, keyless, each chapter a runnable example: first plugin → lifecycle & effects → services → events → config → composition & HMR → into the harness. (~2–3 hours. This is the single best investment; it is exactly Part 5, hands-on.)
2. **Boot dsh and inspect the tree** — `npx @deepseek-ai/dsh web`, then `dsh --profile web --dump-config` to see the real composition; patch a row and watch HMR reconcile.
3. **Run the self-modification demo** — `pnpm run demo:cordis` (needs a `DEEPSEEK_API_KEY`): watch the agent inspect and modify its own plugin tree.
4. **Write a real harness plugin** — `docs/user/develop/basic/`: add a model-callable tool registered on `ctx.tools`, with a schema that joins prompt assembly; mount it via a patch overlay.
5. **Run the phone plugin from Part 7** — `examples/mobile-remote/` in this repo: read `src/index.ts` against Part 3's contract, then `dsh web --patch examples/mobile-remote/cordis.patch.yml` and open the printed URL on your phone.
6. **Compose your own agent preset** — copy the preset layout from `apps/cli/config/agent-presets/`, give a session its own tools and persona, keep the host composition shared.
7. **Read the kernel** — `vendor/cordis/src/{context,service,events,fiber,registry,reflect}.ts` (~2,100 lines of the 2,700); you already know the vocabulary from Part 5.
8. **Then go deeper** — `docs/architecture.md`, `docs/cordis-primer.md`, `docs/capability-seams.md`, the extension cookbook (`docs/cookbook/extension-cookbook.md`), and the subsystem pages.

---

## Appendix — Sources and further reading

**DeepSeek Harness (primary):**
- Repository: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (README, AGENTS.md, BENCHMARK.md)
- Architecture: `docs/architecture.md`
- Cordis primer: `docs/cordis-primer.md`
- Cordis tutorial (7 chapters): `docs/cordis-tutorial/`
- Vendored kernel source: `vendor/cordis/src/*.ts` (+ sync/modification log in `vendor/README.md`)
- Capability seams: `docs/capability-seams.md`; glossary: `docs/glossary.md`
- Self-referential toolset: `packages/extensions/tool-cordis/`; demo: `examples/web-cordis/`
- Per-session presets: `packages/preset/`
- Cordis upstream: [cordiverse/cordis](https://github.com/cordiverse/cordis), design paper: [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/cordiverse/paper)

**pi (primary):**
- Repository: [earendil-works/pi](https://github.com/earendil-works/pi) (README, `packages/agent`, `packages/coding-agent`, `packages/ai`)
- Project site: [pi.dev](https://pi.dev)

**Claude Code (primary):**
- Official docs: [code.claude.com/docs](https://code.claude.com/docs/en/overview) — in particular [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works) (agentic loop, "agentic harness" definition, tools, sessions), [Permission modes](https://code.claude.com/docs/en/permission-modes), [Permissions](https://code.claude.com/docs/en/permissions), [Sandboxing](https://code.claude.com/docs/en/sandboxing), [Memory](https://code.claude.com/docs/en/memory), [Hooks guide](https://code.claude.com/docs/en/hooks-guide) + [Hooks reference](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp), [Skills](https://code.claude.com/docs/en/skills), [Subagents](https://code.claude.com/docs/en/sub-agents), [Plugins](https://code.claude.com/docs/en/plugins), [Features overview](https://code.claude.com/docs/en/features-overview), [Tools reference](https://code.claude.com/docs/en/tools-reference), [Costs](https://code.claude.com/docs/en/costs), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), [Glossary](https://code.claude.com/docs/en/glossary)
- Engineering blog: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode)
- GitHub: [anthropics/claude-code](https://github.com/anthropics/claude-code) (LICENSE, CHANGELOG, examples/hooks, plugins/)

**Raw research captured while writing this tutorial:** `notes/` (pi research, Claude Code research, and scraped primary docs under `notes/research-raw/`).

**The example plugin from Part 7:** `examples/mobile-remote/` in this repo (source, patch overlay, README).
