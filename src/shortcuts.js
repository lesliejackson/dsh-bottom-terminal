const profiles = ['desktop:windows', 'desktop:macos', 'desktop:linux', 'web:macos', 'web:windows']
const legacyShortcuts = [
  ['toggle', 'Backquote'],
  ['newTab', 'Backslash'],
  ['closeActiveTab', 'Digit9'],
  ['fullscreen', 'Quote'],
  ['previousTab', 'BracketLeft'],
  ['nextTab', 'BracketRight'],
  ['previousPane', 'Comma'],
  ['nextPane', 'Period'],
]
const controlShift = ['control', 'shift']
const paneShortcuts = [
  ['splitRight', 'Digit1', controlShift, 'Ctrl+Shift+1'],
  ['splitDown', 'Digit2', controlShift, 'Ctrl+Shift+2'],
  ['focusPaneLeft', 'ArrowLeft', controlShift, 'Ctrl+Shift+←'],
  ['focusPaneRight', 'ArrowRight', controlShift, 'Ctrl+Shift+→'],
  ['focusPaneUp', 'ArrowUp', controlShift, 'Ctrl+Shift+↑'],
  ['focusPaneDown', 'ArrowDown', controlShift, 'Ctrl+Shift+↓'],
  ['togglePaneZoom', 'KeyM', ['control'], 'Ctrl+M'],
]
const paneKeys = new Set(paneShortcuts.map(([key]) => key))
const globalKeys = new Set(['toggle', 'newTab', 'fullscreen'])
const panelSelector = '.dsh-bottom-terminal'
const editableSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

function matchesBinding(event, binding) {
  const { code, modifiers, secondCode } = binding
  return secondCode === undefined && event.code === code
    && event.ctrlKey === modifiers.includes('control')
    && event.altKey === modifiers.includes('alt')
    && event.shiftKey === modifiers.includes('shift')
    && event.metaKey === modifiers.includes('meta')
}

export function registerShortcuts(service, t, actions) {
  const linuxWeb = service.runtime === 'web' && service.platform === 'linux'
  const disposers = []
  const paneBindings = new Map()
  const linuxBindings = new Map()

  function resolve(key, target) {
    const inPanel = target?.closest(panelSelector)
    const terminal = target?.closest('.xterm')
    if ((key === 'closeActiveTab' || paneKeys.has(key)) && !inPanel) return
    if (paneKeys.has(key) && !terminal && target?.closest(editableSelector)) return
    if (!globalKeys.has(key) && terminal && !inPanel) return
    return actions.current?.[key]
  }

  for (const [key, code, modifiers = ['primary', 'shift'], keyLabel] of [...legacyShortcuts, ...paneShortcuts]) {
    const pane = keyLabel !== undefined
    const cyclic = key === 'previousPane' || key === 'nextPane'
    const supported = cyclic ? [...profiles, 'web:linux'] : profiles
    const binding = { code, modifiers }
    // DSH validates defaults for every profile at registration. Keep dock-scoped
    // defaults local so they also pass through outside the dock on native desktop.
    const id = 'bottom-terminal.' + key
    const defaults = pane ? {} : Object.fromEntries(supported.map(value => [value, binding]))
    try {
      disposers.push(service.register({
        id,
        // The editor shows these rows as unbound, so the name carries the working default.
        label: pane ? () => t('paneCommand', { name: t(key), keys: keyLabel }) : () => t(key),
        aliases: pane ? ['terminal', '底栏终端', '分屏', keyLabel] : ['terminal'],
        defaults,
        regions: globalKeys.has(key) ? ['page', 'editable', 'terminal'] : ['page', 'terminal'],
        modals: [],
        resolve({ modal, target }) {
          const run = modal === null ? resolve(key, target) : undefined
          return run ? { status: 'handled', run } : { status: 'pass' }
        },
      }))
      if (pane) paneBindings.set(id, { key, binding })
      if (linuxWeb && !pane && !cyclic) linuxBindings.set(code, key)
    } catch (error) {
      console.warn('[bottom-terminal] Shortcut registration failed:', key, error)
    }
  }

  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.key === 'Dead' || event.getModifierState('AltGraph')) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest('[role="dialog"]')
        || document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], dialog[open]')) return

    // Capture matching commands before xterm consumes their key events.
    if (paneBindings.size && target.closest(panelSelector) && service.config.getSnapshot().status !== 'loading') {
      for (const row of service.catalog.getSnapshot()) {
        const spec = paneBindings.get(row.id)
        if (!spec || row.issue !== null || row.conflicts.length) continue
        const binding = row.modified ? row.binding : spec.binding
        if (!binding || !matchesBinding(event, binding)) continue
        if (!row.modified && service.describeBinding(binding).conflicts.length) continue
        const run = resolve(spec.key, target)
        if (!run) return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) run()
        return
      }
    }

    if (event.repeat || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return
    const legacy = linuxBindings.get(event.code)
    if (!legacy || (!globalKeys.has(legacy) && !target.closest(panelSelector) && target.closest(editableSelector))) return
    const run = resolve(legacy, target)
    if (!run) return
    event.preventDefault()
    event.stopPropagation()
    run()
  }

  const capture = paneBindings.size > 0 || linuxBindings.size > 0
  if (capture) window.addEventListener('keydown', keydown, true)
  return () => {
    if (capture) window.removeEventListener('keydown', keydown, true)
    for (const dispose of disposers) dispose()
  }
}
