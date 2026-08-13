# dsh_101 — Learning DeepSeek Harness

A learning workspace about the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), the open-source "everything is a plugin" agent harness — focused on **what a plugin is**, the Cordis plugin runtime kernel, and a real plugin you can run.

## 📱 Read it on your phone

The tutorial is published as a GitHub Page:

**https://zeecares.github.io/dsh_101/**

(served from `docs/index.html` in this repo — mobile-friendly, with table of contents.)

## Contents

- **`tutorial.md`** — the main tutorial: *From Claude Code to DeepSeek Harness*. Covers the evolution Claude Code → pi → dsh, a plain-language **"What is a plugin?"** chapter, the core plugin runtime kernel (Cordis), and ends with a real plugin.
- **`examples/mobile-remote/`** — the Part 7 example plugin: open the harness Web UI to your phone via a managed cloudflared quick tunnel. Includes source, patch overlay, and README.
- **`docs/index.html`** — the generated mobile-friendly HTML of the tutorial (GitHub Pages source).
- **`notes/`** — raw research behind the tutorial:
  - `pi-research.md` — pi (earendil-works/pi) architecture notes (primary-source based)
  - `claude-code-research.md` — Claude Code extension model notes (53 primary-source citations)
  - `research-raw/` — scraped primary documentation (safe to delete)

## Regenerate the HTML

```sh
cd site && ./build.sh        # requires pandoc; writes ../docs/index.html
```

## Key facts (quick reference)

- dsh: `npx @deepseek-ai/dsh web` → Web UI at http://127.0.0.1:3080
- Architecture: "everything is a plugin", powered by Cordis; the agent loop itself is a plugin
- Kernel: vendored Cordis, ~2,700 lines of TypeScript in `vendor/cordis/src/`
- A plugin = a function that receives `ctx` and registers reversible contributions
- Flagship demo: the agent inspects and modifies its own running plugin tree (`demo:cordis`)
- Phone access: `examples/mobile-remote/` (cloudflared quick tunnel) or Tailscale/LAN
