import websocket from './lib/ws.cjs'
import { MAX_TERMINALS, PATH, serveTerminal } from './src/transport.js'

const { WebSocketServer } = websocket

export const inject = ['webServer', 'connection', 'subprocess', 'workingDirectory', 'sessionController']

const profiles = {
  bash: ['bash', '-i'],
  zsh: ['zsh', '-i'],
  fish: ['fish', '-i'],
  pwsh: ['pwsh', '-NoLogo'],
  powershell: ['powershell.exe', '-NoLogo'],
  cmd: ['cmd.exe'],
  wsl: ['wsl.exe', '--cd', '.'],
}

async function spawn(ctx, request, signal) {
  let { subprocess } = ctx
  let cwd = ctx.workingDirectory.defaultDirectory || process.cwd()
  if (request.sessionId !== undefined) {
    const result = await ctx.sessionController.resolveAgent(request.sessionId)
    signal.throwIfAborted()
    if ('error' in result) throw result.error
    const { agent } = result
    subprocess = agent.ctx.get('subprocess')
    const directory = agent.ctx.get('workingDirectory')
    if (!subprocess || !directory) throw new Error('The selected Session has no terminal execution environment')
    cwd = await directory.ensure(agent, signal)
  }

  let profile = profiles[request.shell]
  if (!profile) {
    const environment = await subprocess.terminalEnvironment(signal)
    const path = environment.defaultShell || (environment.platform === 'windows' ? 'cmd.exe' : '/bin/sh')
    const kind = path.split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, '')
    profile = [path, ...(profiles[kind]?.slice(1) ?? ['-i'])]
  }
  const [executable, ...args] = profile
  const path = await subprocess.resolveExecutable(executable, undefined, signal)
  const handle = await subprocess.spawnTerminal({
    argv: [path, ...args], cwd, cols: request.cols, rows: request.rows,
    terminalType: 'xterm-256color',
    env: { COLORTERM: 'truecolor', ...(request.sessionId && { DSH_SESSION_ID: request.sessionId }) },
    graceMs: 1000, signal,
  })
  return { handle, cwd, shell: path.split(/[\\/]/).at(-1) }
}

export function apply(ctx) {
  ctx.effect(() => {
    const server = new WebSocketServer({
      noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false,
    })
    const connections = new Map()
    const tasks = new Set()
    const report = error => ctx.logger.warn('[bottom-terminal]', error)
    const off = ctx.webServer.registerUpgrade({
      path: PATH,
      handler(req, socket, head) {
        const admission = ctx.connection.admit(req)
        // The browser owner can run an interactive shell. API peers can have
        // narrower capabilities even when their HTTP authentication succeeds.
        if (!admission.peer || admission.peer !== ctx.connection.browserPeer || !req.headers.origin) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
          return
        }
        if (tasks.size >= MAX_TERMINALS) {
          socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n')
          return
        }
        server.handleUpgrade(req, socket, head, ws => {
          connections.set(ws, true)
          ws.on('pong', () => connections.set(ws, true))
          ws.once('close', () => connections.delete(ws))
          const task = serveTerminal(ws, (request, signal) => spawn(ctx, request, signal), report)
          tasks.add(task)
          void task.then(() => tasks.delete(task), error => {
            tasks.delete(task)
            report(error)
          })
        })
      },
    })
    const heartbeat = setInterval(() => {
      for (const [ws, alive] of connections) {
        if (!alive) {
          ws.terminate()
        } else if (ws.readyState === 1) {
          connections.set(ws, false)
          ws.ping()
        }
      }
    }, 20_000)
    heartbeat.unref()
    return async () => {
      off()
      clearInterval(heartbeat)
      for (const ws of connections.keys()) ws.terminate()
      await Promise.allSettled(tasks)
      server.close()
    }
  }, 'bottom-terminal: browser PTY transport')
}
