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
  ['splitRight', 'Digit1', controlShift],
  ['splitDown', 'Digit2', controlShift],
  ['focusPaneLeft', 'ArrowLeft', controlShift],
  ['focusPaneRight', 'ArrowRight', controlShift],
  ['focusPaneUp', 'ArrowUp', controlShift],
  ['focusPaneDown', 'ArrowDown', controlShift],
  ['togglePaneZoom', 'KeyM', ['control']],
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
  const profile = service.runtime + ':' + service.platform
  const native = profile === 'desktop:windows' || profile === 'desktop:macos'
  const linuxWeb = profile === 'web:linux'
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

  for (const [key, code, modifiers = ['primary', 'shift']] of [...legacyShortcuts, ...paneShortcuts]) {
    const pane = paneKeys.has(key)
    const cyclic = key === 'previousPane' || key === 'nextPane'
    const supported = pane || cyclic ? [...profiles, 'web:linux'] : profiles
    const binding = { code, modifiers }
    // Native defaults are consumed before DSH can check focus. Handle these defaults
    // in the dock, as with combinations the browser registry does not admit.
    const fallback = pane && (native || service.describeBinding(binding).issue !== null)
    const id = 'bottom-terminal.' + key
    const defaults = Object.fromEntries(supported
      .filter(value => !fallback || value !== profile)
      .map(value => [value, binding]))
    try {
      disposers.push(service.register({
        id,
        label: () => t(key), aliases: ['terminal'],
        defaults,
        regions: globalKeys.has(key) ? ['page', 'editable', 'terminal'] : ['page', 'terminal'],
        modals: [],
        resolve({ modal, target }) {
          const run = modal === null ? resolve(key, target) : undefined
          return run ? { status: 'handled', run } : { status: 'pass' }
        },
      }))
      if (pane) paneBindings.set(id, { key, fallback: fallback ? binding : null })
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
        const binding = row.modified ? row.binding : row.binding ?? spec.fallback
        if (!binding || !matchesBinding(event, binding)) continue
        if (!row.binding && service.describeBinding(binding).conflicts.length) continue
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
