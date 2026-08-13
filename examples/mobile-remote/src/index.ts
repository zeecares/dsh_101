/**
 * mobile-remote — a DeepSeek Harness plugin that opens the Web UI to your phone.
 *
 * What it does:
 *   1. Spawns `cloudflared tunnel --url http://127.0.0.1:<port>` as a MANAGED
 *      child process (a quick tunnel — no account, no router config, public
 *      HTTPS URL that works on any network, including cellular).
 *   2. Watches cloudflared's stderr for the published `https://*.trycloudflare.com`
 *      URL and logs it.
 *   3. Serves `GET /mobile-remote` (through the same tunnel) as JSON so a
 *      browser half or a bookmark can show the live URL.
 *   4. Kills the tunnel when the plugin unloads — the whole capability is one
 *      reversible effect.
 *
 * Why this is a good "what is a plugin" example:
 *   - It is a plain function with `inject` + `apply(ctx, config)`.
 *   - It depends on services by KEY (`ctx.subprocess`), not by importing them.
 *   - Its only side effects are registered through `ctx.effect(...)`, so
 *     unload unwinds them (the child process is terminated, the route removed).
 *   - Its config is validated and comes from the cordis.yml row.
 *
 * Mount it (from a dsh repo checkout, dev launcher):
 *   dsh web --patch examples/mobile-remote/cordis.patch.yml
 *
 * Requires: `cloudflared` on PATH (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
 *
 * Trust note: a quick tunnel exposes the harness to the public internet for as
 * long as the plugin is mounted. Only enable it on a machine you control, and
 * rely on the harness's own approval/sandbox policy for what callers may do.
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'mobile-remote'

export interface Config {
  /** Local port of the harness web UI (the `webserver` row's port). */
  port: number
  /** 'cloudflared' spawns a managed quick tunnel; 'none' only logs the local URL. */
  tunnel: 'cloudflared' | 'none'
  /** Executable name or absolute path for cloudflared. */
  cloudflaredPath: string
  /** How long to wait for the process tree to exit on unload (ms). */
  graceMs: number
}

export const Config = {
  port: 3080,
  tunnel: 'cloudflared',
  cloudflaredPath: 'cloudflared',
  graceMs: 5000,
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('mobile-remote')
  const localUrl = `http://127.0.0.1:${config.port}`
  const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

  // A closure holding the tunnel URL once cloudflared publishes it.
  let publicUrl: string | undefined

  // Optional service — the route only exists in a composition that has a web
  // server (the `web` profile does). Hard-injecting it would make this plugin
  // fail to load in headless compositions.
  const webServer = ctx.get('webServer')

  if (config.tunnel === 'cloudflared') {
    // ONE reversible effect = the whole capability. Unload kills the tunnel.
    ctx.effect(() => {
      logger.info('spawning cloudflared quick tunnel for %s', localUrl)

      const handle = ctx.subprocess.spawn({
        argv: [config.cloudflaredPath, 'tunnel', '--url', localUrl, '--no-autoupdate'],
        cwd: process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 64 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: config.graceMs,
      })

      // cloudflared prints the published URL on stderr. The collect mode keeps
      // a bounded tail; on 'data' we just scan raw chunks for the URL.
      handle.stderr?.on('data', (chunk: Buffer) => {
        const match = urlPattern.exec(chunk.toString())
        if (match && !publicUrl) {
          publicUrl = match[0]
          logger.info('phone URL: %s', publicUrl)
        }
      })

      // Report spawn-level failures loudly instead of silently doing nothing.
      handle.done.catch((error) => {
        logger.warn('cloudflared exited with error: %s', error)
      })

      // Reversible half: terminate the process tree and wait for real exit.
      return async () => {
        logger.info('stopping cloudflared tunnel')
        handle.terminate()
        await handle.waitForExit()
      }
    })
  } else {
    logger.info('tunnel disabled; local URL is %s', localUrl)
  }

  // Serve the live URL over the same web server, so the phone (through the
  // tunnel) and the desktop UI can both read it.
  if (webServer) {
    webServer.register({
      kind: 'exact',
      path: '/mobile-remote',
      handler(_req, res) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          status: publicUrl ? 'up' : 'connecting',
          localUrl,
          publicUrl: publicUrl ?? null,
          hint: 'Open publicUrl on your phone, or scan a QR code of it.',
        }))
      },
    })
  }
}
