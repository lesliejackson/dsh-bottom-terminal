export const PATH = '/bottom-terminal/pty'
export const MAX_COLS = 500
export const MAX_ROWS = 200
export const SHELLS = ['default', 'pwsh', 'powershell', 'cmd', 'wsl', 'bash', 'zsh', 'fish']

const BLOCK = 32 * 1024
const WINDOW = 256 * 1024
const MAX_INPUT = 128 * 1024

function validSize(cols, rows) {
  return Number.isInteger(cols) && cols >= 2 && cols <= MAX_COLS
    && Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS
}

export function serveTerminal(ws, spawn, report) {
  const controller = new AbortController()
  const { signal } = controller
  let resolveClosed
  const closed = new Promise(resolve => { resolveClosed = resolve })
  let started = false
  let handle
  let allocation
  let flushJob
  let outstanding = 0
  let pendingBytes = 0
  let pending = []
  let queuedInput = 0
  let operations = Promise.resolve()
  let ended = false

  const send = message => {
    if (ws.readyState === 1) ws.send(JSON.stringify(message))
  }
  const fail = error => {
    if (ended || signal.aborted) return
    ended = true
    send(['error', String(error?.message ?? error).slice(0, 500)])
    ws.close(1011)
  }

  const flush = () => {
    clearImmediate(flushJob)
    flushJob = undefined
    if (signal.aborted || ws.readyState !== 1 || pendingBytes === 0) return
    const chunk = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes)
    pending = []
    pendingBytes = 0
    outstanding += chunk.byteLength
    ws.send(chunk, { binary: true })
  }

  const onOutput = chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    pending.push(bytes)
    pendingBytes += bytes.byteLength
    if (outstanding + pendingBytes >= WINDOW) handle.output.pause()
    if (pendingBytes >= BLOCK) flush()
    else flushJob ??= setImmediate(flush)
  }

  const startTimer = setTimeout(() => fail('No terminal start request received'), 10_000)
  startTimer.unref()

  async function start(request) {
    const session = await spawn(request, signal)
    handle = session.handle
    const outcome = handle.done.then(value => ({ value }), error => {
      fail(error)
      return { error }
    })
    handle.output.on('error', fail)
    if (signal.aborted || ended) return
    send(['ready', session.shell, session.cwd])
    handle.output.on('data', onOutput)
    handle.output.once('end', () => {
      flush()
      void outcome.then(({ value }) => {
        if (!value || ended || signal.aborted) return
        ended = true
        send(['exit', value.exitCode, value.signal])
        ws.close(1000)
      })
    })
  }

  function onMessage(raw, binary) {
    if (ended || signal.aborted) return
    let message
    try { message = binary ? null : JSON.parse(raw.toString()) }
    catch (error) {
      fail('Invalid terminal message')
      return
    }
    if (!Array.isArray(message)) {
      fail('Invalid terminal message')
      return
    }
    const [op, a, b, c, d] = message
    if (op === 'start') {
      const validSession = c === null || (typeof c === 'string' && c.length > 0 && c.length <= 256)
      if (started || !validSize(a, b) || !SHELLS.includes(d) || !validSession) {
        fail('Invalid terminal start request')
        return
      }
      clearTimeout(startTimer)
      started = true
      allocation = start({ cols: a, rows: b, sessionId: c ?? undefined, shell: d }).catch(fail)
      return
    }
    if (!handle) {
      fail('Terminal is not ready')
      return
    }
    if (op === 'ack' && Number.isSafeInteger(a) && a > 0 && a <= outstanding) {
      outstanding -= a
      if (outstanding + pendingBytes < WINDOW / 2) handle.output.resume()
      return
    }
    const input = op === 'input' && typeof a === 'string'
    if (!input && !(op === 'resize' && validSize(a, b))) {
      fail('Invalid terminal operation')
      return
    }
    const cost = input ? Buffer.byteLength(a) + 1 : 16
    if (queuedInput + cost > MAX_INPUT) {
      fail('Terminal input buffer exceeded')
      return
    }
    queuedInput += cost
    operations = operations.then(async () => {
      if (signal.aborted || ended) return
      if (input) await handle.write(a)
      else await handle.resize(a, b)
    }).catch(fail).finally(() => { queuedInput -= cost })
  }

  ws.on('message', onMessage)
  ws.on('error', () => ws.terminate())
  ws.once('close', () => {
    controller.abort()
    clearTimeout(startTimer)
    clearImmediate(flushJob)
    resolveClosed()
  })
  return closed.then(async () => {
    await allocation
    if (!handle) return
    handle.output.off('data', onOutput)
    // Drain the provider during teardown so a blocked PTY can exit.
    handle.output.resume()
    // Provider termination aborts in-flight operations and waits for quiescence.
    await handle.terminate()
    await operations
  }).catch(report)
}
