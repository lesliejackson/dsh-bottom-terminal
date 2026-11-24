import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalFont, themes } from './appearance.js'
import { MAX_COLS, MAX_ROWS, PATH } from './transport.js'

function socketUrl() {
  const base = new URL(globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI)
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const url = new URL(PATH.slice(1), base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

export function mountScreen(element, options, onStatus) {
  const term = new Terminal({
    fontFamily: terminalFont(options.preferences.font), fontSize: options.preferences.fontSize,
    theme: themes[options.preferences.theme].terminal, scrollback: 3500,
    cursorBlink: false, cursorStyle: 'block', allowTransparency: false,
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(element)
  let socket
  let ready = false
  let disposed = false
  let status = { state: 'opening', renderer: 'dom' }
  let preferences = options.preferences
  let visible = false
  let fitJob
  let gpu
  let gpuJob
  let gpuFailed = false
  let lastSize

  function publish(update) {
    status = { ...status, ...update }
    if (!disposed) onStatus(status)
  }

  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  function open(cols, rows) {
    try { socket = new WebSocket(socketUrl()) }
    catch (error) {
      publish({ state: 'error', detail: error.message })
      return
    }
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
      cols = term.cols
      rows = term.rows
      send(['start', cols, rows, options.sessionId ?? null, options.shell])
    }
    socket.onmessage = ({ data }) => {
      if (disposed) return
      if (typeof data !== 'string') {
        const bytes = new Uint8Array(data)
        term.write(bytes, () => {
          send(['ack', bytes.byteLength])
        })
        return
      }
      const [op, a, b] = JSON.parse(data)
      if (op === 'ready') {
        ready = true
        publish({ state: 'ready', shell: a, cwd: b })
        if (cols !== term.cols || rows !== term.rows) send(['resize', term.cols, term.rows])
      } else if (op === 'exit') {
        ready = false
        publish({ state: 'exit', detail: a ?? b })
      } else if (op === 'error') {
        ready = false
        publish({ state: 'error', detail: a })
      }
    }
    socket.onerror = () => {
      if (status.state === 'opening') publish({ state: 'unavailable' })
    }
    socket.onclose = () => {
      ready = false
      if (status.state === 'opening' || status.state === 'ready') publish({ state: 'unavailable' })
    }
  }

  const doFit = () => {
    fitJob = undefined
    if (!visible || element.clientHeight === 0 || element.clientWidth === 0) return
    const size = fit.proposeDimensions()
    if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return
    const cols = Math.max(2, Math.min(MAX_COLS, size.cols))
    const rows = Math.max(1, Math.min(MAX_ROWS, size.rows))
    if (lastSize?.cols === cols && lastSize.rows === rows) return
    lastSize = { cols, rows }
    term.resize(cols, rows)
    if (!socket && status.state === 'opening') open(cols, rows)
    else if (ready) send(['resize', cols, rows])
  }
  const scheduleFit = () => {
    if (visible && fitJob === undefined) fitJob = requestAnimationFrame(doFit)
  }

  function disposeGpu() {
    clearTimeout(gpuJob)
    gpuJob = undefined
    const addon = gpu
    gpu = undefined
    if (addon) {
      addon.dispose()
      publish({ renderer: 'dom' })
    }
  }

  function scheduleGpu() {
    if (!visible || preferences.renderer !== 'auto' || gpu || gpuFailed || gpuJob !== undefined) return
    gpuJob = setTimeout(() => {
      gpuJob = undefined
      if (disposed || !visible) return
      const addon = new WebglAddon()
      try {
        term.loadAddon(addon)
        gpu = addon
        addon.onContextLoss(() => {
          gpuFailed = true
          disposeGpu()
        })
        publish({ renderer: 'webgl' })
      } catch (error) {
        gpuFailed = true
        console.debug('[bottom-terminal] WebGL unavailable', error)
      }
    }, 60)
  }

  const observer = new ResizeObserver(scheduleFit)
  observer.observe(element)
  document.fonts?.addEventListener('loadingdone', scheduleFit)
  function copySelection() {
    const clipboard = navigator.clipboard
    if (!clipboard || !term.hasSelection()) return false
    const text = term.getSelection()
    if (text === '') return false
    void clipboard.writeText(text).catch(error => {
      console.debug('[bottom-terminal] Clipboard write failed', error)
    })
    return true
  }

  // For mouse selections, xterm emits this event when the gesture ends.
  const selectionChange = term.onSelectionChange(copySelection)
  // xterm handles normal paste and IME. Copying a selection never takes Ctrl+C
  // away from the shell, and the browser keeps its usual Ctrl+V / Cmd+V path.
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return true
    if (event.code !== 'KeyC' || !copySelection()) return true
    event.preventDefault()
    return false
  })
  term.onData(data => {
    if (!ready) return
    // Bound each WebSocket message and leave surrogate pairs intact.
    for (const chunk of data.match(/[\s\S]{1,2048}/gu) ?? []) send(['input', chunk])
  })
  publish({})
  return {
    focus: () => term.focus(),
    setVisible(value) {
      visible = value
      if (!visible) return
      scheduleFit()
      scheduleGpu()
    },
    setPreferences(value) {
      if (preferences.theme !== value.theme) term.options.theme = themes[value.theme].terminal
      if (preferences.font !== value.font) term.options.fontFamily = terminalFont(value.font)
      if (preferences.fontSize !== value.fontSize) term.options.fontSize = value.fontSize
      if (preferences.renderer !== value.renderer) {
        if (value.renderer === 'dom') disposeGpu()
        else gpuFailed = false
      }
      preferences = value
      scheduleFit()
      scheduleGpu()
    },
    dispose() {
      disposed = true
      clearTimeout(gpuJob)
      cancelAnimationFrame(fitJob)
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', scheduleFit)
      socket?.close()
      selectionChange.dispose()
      term.dispose()
    },
  }
}
