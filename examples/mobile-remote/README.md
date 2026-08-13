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
([download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)),
and a running dsh web profile (your harness is at `http://127.0.0.1:3080`).

**0. Fix the name (one-time, per machine).** Plugin names in patch overlays
resolve against the **profile directory** (`$DSH_HOME/profiles/<name>/`), not
against the patch file — so open `cordis.patch.yml` and replace
`/REPLACE/WITH/ABSOLUTE/PATH/...` with the absolute path to this directory's
`src/index.ts`. (Alternatively drop this `src/index.ts` file into
`~/.dsh/profiles/web/` and use `name: './src/index.ts'`; or publish it as an
npm package and use its name.)

**1. Boot with the patch** (from a dsh repo checkout, dev launcher):

```sh
dsh web --patch examples/mobile-remote/cordis.patch.yml
```

**2. Watch the log** for the phone URL:

```
mobile-remote: phone URL: https://<random>.trycloudflare.com
```

**3. Open it on your phone.** `curl https://<random>.trycloudflare.com/mobile-remote`
returns `{ "status": "up", "localUrl": ..., "publicUrl": ... }`.

### Already running? Hot-mount it without a restart

The web profile's own `cordis.patch.yml` (`~/.dsh/profiles/web/cordis.patch.yml`)
is watched by the harness (HMR): add the same row there with an absolute
`name:`, and the running process mounts the plugin live — no restart.

### Zero-plugin alternative (works with any running harness)

```sh
cloudflared tunnel --url http://127.0.0.1:3080
```

Same public URL, no plugin — the plugin exists to make this turnkey and to
teach the plugin runtime.

### Private alternative: Tailscale (no plugin, no public exposure)

1. Install Tailscale on the Mac and the phone; both logged into the same
   tailnet (`tailscale status` shows every device and its `100.x.y.z` IP).
2. **Recommended: use Tailscale Serve for HTTPS** (the web UI needs a *secure
   context* — `crypto.randomUUID()` is a secure-context-only browser API, so
   plain `http://<tailnet-ip>:3080` loads on the phone but the workspace/session
   flow throws "crypto.randomUUID is not a function").
   - One-time: enable **HTTPS certificates** in the Tailscale admin console
     (`login.tailscale.com` → DNS → Enable HTTPS).
   - Then proxy the harness over valid TLS, tailnet-only:

     ```sh
     tailscale serve --bg http://127.0.0.1:3080
     # → https://<machine>.<tailnet>.ts.net/   (valid Let's Encrypt cert)
     ```

   - This also lets you revert the webserver patch to loopback-only (step 3
     becomes unnecessary — Serve reaches the local port itself).
4. **Declare the serving authority to the `/api` trust fence.** Every `/api`
   request is gated by a DNS-rebinding fence (`isTrustedApiRequest` in
   `packages/client/connection/src/api-request-trust.ts`): the `Host` must be
   loopback or a declared `trustedHosts` authority, else **HTTP 403** (that's
   the "transport failure for /api/host.listDirectory" on the phone). Add the
   `ts.net` hostname to the `connection` row in the profile's `cordis.patch.yml`
   (hot-mounts via HMR):

   ```yaml
   - id: connection
     config:
       trustedHosts:
         - <machine>.<tailnet>.ts.net
   ```

   Two real-world notes: (a) use the static list form — the *packaged* npm
   build's overlay parser rejects the `!!js` tag even though the repo docs and
   the profile template mention it; (b) some methods stay loopback-pinned even
   with `trustedHosts` (`host.pickDirectory` opens the host's native dialog),
   so the native-picker button may still 403 from a remote browser — use the
   in-UI directory browser / typed path, or add the workspace from the desktop
   session.
3. If you prefer the raw-IP route instead: patch the webserver to listen on
   all interfaces so the tailnet interface is reachable. Edit the profile's
   own `cordis.patch.yml` (`~/.dsh/profiles/web/cordis.patch.yml`) — it
   hot-mounts via HMR, no restart:

   ```yaml
   - id: webserver
     config:
       host: 0.0.0.0
       port: 3080
   ```

   then browse to `http://<mac-tailnet-ip>:3080` (viewing only — see the
   secure-context caveat above).

Caveats: binding `0.0.0.0` also exposes port 3080 to the local LAN (same
Wi-Fi); the tailnet is the privacy boundary, so use a trusted network or the
macOS firewall if that matters. The Mac must stay on, awake, online, and the
harness process running. `tailscale serve`'s config persists across reboots;
the harness process itself does not auto-start.

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
