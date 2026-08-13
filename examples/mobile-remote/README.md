# mobile-remote — run DeepSeek Harness from your phone

A small, honest example of **what a plugin is** in DeepSeek Harness, built
against the real service contracts (`ctx.subprocess`, `ctx.webServer`).

It opens the harness Web UI to your phone by spawning a managed
**cloudflared quick tunnel** — a public HTTPS URL that works on any network
(including cellular), with no account and no router configuration.

## The three ways to reach the Web UI from a phone

| Option | Effort | Security | When to use |
|---|---|---|---|
| **cloudflared quick tunnel** (this plugin) | zero config | public URL — anyone with the link can reach the harness; rely on dsh's approval/sandbox policy | anywhere, any network |
| **Tailscale** (no plugin) | install on laptop + phone | private tailnet, encrypted; patch `webserver.host` to `0.0.0.0` | you want privacy, both devices on your tailnet |
| **LAN** (no plugin) | same Wi-Fi only | your network's trust | quick testing at home |

> For Tailscale/LAN, you do not need this plugin at all: `npx @deepseek-ai/dsh web`
> already serves a full web app — the phone just needs a route to the machine.
> The plugin exists to make the public-tunnel path turnkey *and* to teach the
> plugin runtime: services by key, reversible effects, validated config.

## How it works (the "what is a plugin" tour)

```text
cordis.patch.yml  ──inserts row──▶  mobile-remote  ──inject──▶  ctx.subprocess
                                                              ctx.webServer (optional)
```

1. **A plugin is a function.** `src/index.ts` exports `name`, `Config` (validated
   from the row's `config`), and `apply(ctx, config)`.
2. **It depends on services by key.** `inject: ['subprocess']` means the plugin
   only loads once `ctx.subprocess` exists. `ctx.webServer` is read optionally
   (`ctx.get`), so the plugin still loads in headless compositions.
3. **Its side effects are reversible.** Everything happens inside one
   `ctx.effect(...)`; the disposer terminates the tunnel and awaits real exit,
   so unload (config change, patch removal, process stop) unwinds cleanly.
4. **It serves its own data.** A `ctx.webServer` route `GET /mobile-remote`
   returns `{ status, localUrl, publicUrl }` — reachable from the phone through
   the same tunnel.

## Run it

Requires `cloudflared` on PATH
([download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).

```sh
# from a dsh repo checkout (dev launcher)
dsh web --patch examples/mobile-remote/cordis.patch.yml
```

Expected log line:

```
mobile-remote: phone URL: https://<random>.trycloudflare.com
```

Open that URL on your phone. `curl https://<random>.trycloudflare.com/mobile-remote`
returns the live status JSON.

## Layout

```
examples/mobile-remote/
├── src/index.ts            # the plugin (host half)
└── cordis.patch.yml        # the composition row that mounts it
```

## Honest caveats

- **This is a teaching example, not a published plugin.** The `name:` specifier
  in the patch resolves relative to how you boot dsh (repo checkout vs npm
  install). Publishing a real plugin uses the bundle system — see
  `docs/user/develop/basic/` in the harness repo.
- **Quick tunnels are public.** Anyone who learns the URL can drive the harness
  while it is up. Mount it only on machines you control, and keep the harness's
  approval policy strict. Cloudflare quick-tunnel URLs are long random strings,
  but "security by unguessability" is not a boundary.
- The plugin was written against the live service contracts
  (`SubprocessSpawnSpec`, `WebRoute`) but not end-to-end tested with a real
  cloudflared binary in this environment.
