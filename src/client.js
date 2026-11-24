import React from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import panelCss from './panel.css'
import { readPreferences, savePreferences, themes } from './appearance.js'
import { geometry, leaf, leaves, removePane, resizeSplit, splitPane } from './layout.js'
import { mountScreen } from './screen.js'
import { MAX_TERMINALS, SHELLS } from './transport.js'
import { en, zh } from './labels.js'

const { createElement: h, useEffect, useLayoutEffect, useRef, useState } = React
const profiles = ['desktop:windows', 'desktop:macos', 'desktop:linux', 'web:macos', 'web:windows']
const shortcuts = [
  ['toggle', 'Backquote'],
  ['previousTab', 'BracketLeft'],
  ['nextTab', 'BracketRight'],
  ['previousPane', 'Comma'],
  ['nextPane', 'Period'],
]
const selectedSession = state => Object.values(state.byId).find(item => item.retainedBy?.mainView > 0)?.id

function glyph(key) {
  return h('span', { 'aria-hidden': true }, key)
}

function tool(label, symbol, action, extra) {
  return h('button', { type: 'button', title: label, 'aria-label': label, onClick: action, ...extra }, glyph(symbol))
}

function circular(items, position, offset) {
  return items[(position + offset + items.length) % items.length]
}

function pointerDrag(event, value) {
  if (event.button !== 0) return
  const handle = event.currentTarget
  const pointer = event.pointerId
  handle.setPointerCapture(pointer)
  const move = next => { if (next.pointerId === pointer) value(next) }
  const stop = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('lostpointercapture', stop)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('lostpointercapture', stop, { once: true })
  event.preventDefault()
}

function Pane({ pane, active, shown, style, preferences, screens, select, restart, t }) {
  const root = useRef(null)
  const instance = useRef(null)
  const [status, setStatus] = useState({ state: 'opening', renderer: 'dom' })

  useLayoutEffect(() => {
    const screen = mountScreen(root.current, {
      preferences, sessionId: pane.sessionId, shell: pane.shell,
    }, setStatus)
    instance.current = screen
    screens.set(pane.id, screen)
    return () => {
      screens.delete(pane.id)
      instance.current = null
      screen.dispose()
    }
  }, [pane, screens])

  useLayoutEffect(() => { instance.current?.setVisible(shown) }, [pane, shown])
  useLayoutEffect(() => { instance.current?.setPreferences(preferences) }, [pane, preferences])

  const stopped = status.state === 'exit' || status.state === 'error' || status.state === 'unavailable'
  const detail = status.detail == null ? '' : ' · ' + status.detail

  return h('div', {
    className: 'dbt-pane', hidden: !shown, style,
    'data-terminal-pane': pane.id, 'data-terminal-state': status.state,
    'data-terminal-renderer': status.renderer, 'data-active': active || undefined,
    onPointerDownCapture: () => select(pane.id), onFocusCapture: () => select(pane.id),
  },
  h('div', {
    className: 'dbt-pane-info',
    title: [status.cwd, status.renderer === 'webgl' ? 'WebGL' : 'DOM'].filter(Boolean).join(' · '),
  },
  h('span', null, status.shell || t('terminal')),
  h('span', null, status.state === 'ready' ? status.cwd : t(status.state) + detail),
  stopped && tool(t('restart'), '↻', restart)),
  h('div', { className: 'dbt-screen', ref: root }))
}

function Settings({ preferences, change, close, t }) {
  const [font, setFont] = useState(preferences.font)
  const fontInput = useRef(null)
  useEffect(() => { fontInput.current?.focus() }, [])

  function field(label, control) { return h('label', null, h('span', null, label), control) }
  function select(name, choices) {
    return field(t(name), h('select', {
      value: preferences[name], onChange: event => change({ [name]: event.target.value }),
    }, choices.map(([value, label]) => h('option', { key: value, value }, label))))
  }
  function saveFont() { change({ font: font.trim() }) }

  return h('div', {
    className: 'dbt-settings', role: 'dialog', 'aria-label': t('appearance'),
    onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); close() } },
  },
  select('theme', Object.entries(themes).map(([key, value]) => [key, value.label])),
  field(t('font'), h('input', {
    ref: fontInput, value: font, maxLength: 200, placeholder: 'JetBrains Mono, Consolas',
    spellCheck: false, onChange: event => setFont(event.target.value), onBlur: saveFont,
    onKeyDown: event => { if (event.key === 'Enter') { saveFont(); event.currentTarget.blur() } },
  })),
  field(t('fontSize'), h('input', {
    type: 'number', min: 9, max: 32, value: preferences.fontSize,
    onChange(event) {
      const number = event.target.valueAsNumber
      if (Number.isInteger(number) && number >= 9 && number <= 32) change({ fontSize: number })
    },
  })),
  select('renderer', [['auto', t('gpu')], ['dom', 'DOM']]),
  select('shell', SHELLS.map(value => [value, value === 'default' ? t('defaultShell') : value])),
  h('button', { className: 'dbt-done', type: 'button', onClick: close }, t('done')))
}

function BottomTerminal({ useSessions, t, actions }) {
  const sessionId = useSessions(selectedSession)
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [tabs, setTabs] = useState([])
  const [selected, setSelected] = useState(null)
  const counter = useRef(0)
  const screens = useRef(new Map()).current
  const button = useRef(null)
  const settingsButton = useRef(null)
  const dock = useRef(null)
  const workspace = useRef(null)
  const tab = tabs.find(entry => entry.id === selected)
  const paneCount = tabs.reduce((total, entry) => total + entry.panes.length, 0)

  function change(update) { setPreferences(current => ({ ...current, ...update })) }
  useEffect(() => { savePreferences(preferences) }, [preferences])

  function newPane() {
    return { id: ++counter.current, sessionId, shell: preferences.shell }
  }

  function addTab() {
    if (paneCount >= MAX_TERMINALS) return
    const pane = newPane()
    setTabs(current => [...current, { id: pane.id, tree: leaf(pane.id), active: pane.id, panes: [pane] }])
    setSelected(pane.id)
    setOpen(true)
  }

  function toggle() {
    if (!open && tabs.length === 0) { addTab(); return }
    setOpen(!open)
    if (open) {
      setSettings(false)
      button.current.focus()
    }
  }

  function updateTab(id, update) {
    setTabs(current => current.map(entry => entry.id === id ? update(entry) : entry))
  }

  function selectPane(id) {
    if (tab && tab.active !== id) updateTab(selected, entry => ({ ...entry, active: id }))
  }

  function addSplit(axis) {
    if (!tab || paneCount >= MAX_TERMINALS) return
    const pane = newPane()
    updateTab(tab.id, entry => ({
      ...entry, tree: splitPane(entry.tree, entry.active, pane.id, axis),
      active: pane.id, panes: [...entry.panes, pane],
    }))
  }

  function closeTab(id) {
    const index = tabs.findIndex(entry => entry.id === id)
    const next = tabs.filter(entry => entry.id !== id)
    setTabs(next)
    if (selected === id) setSelected((next[index] ?? next[index - 1])?.id ?? null)
    if (next.length === 0) button.current.focus()
  }

  function closePane() {
    const tree = removePane(tab.tree, tab.active)
    if (!tree) { closeTab(tab.id); return }
    const before = leaves(tab.tree)
    const after = leaves(tree)
    const active = after[Math.min(before.indexOf(tab.active), after.length - 1)]
    updateTab(tab.id, entry => ({
      ...entry, tree, active, panes: entry.panes.filter(pane => pane.id !== entry.active),
    }))
  }

  function restartPane(owner, id) {
    updateTab(owner, entry => ({
      ...entry, panes: entry.panes.map(pane => pane.id === id ? { ...pane } : pane),
    }))
    requestAnimationFrame(() => screens.get(id)?.focus())
  }

  function switchTab(offset) {
    const next = circular(tabs, tabs.indexOf(tab), offset)
    setSelected(next.id)
  }

  function switchPane(offset) {
    const ids = leaves(tab.tree)
    selectPane(circular(ids, ids.indexOf(tab.active), offset))
  }

  useLayoutEffect(() => {
    if (open && tab && !settings) screens.get(tab.active)?.focus()
  }, [open, selected, tab?.active, settings, screens])

  useLayoutEffect(() => {
    actions.toggle = toggle
    actions.switch = open && tab ? key => {
      if (key === 'previousTab') switchTab(-1)
      if (key === 'nextTab') switchTab(1)
      if (key === 'previousPane') switchPane(-1)
      if (key === 'nextPane') switchPane(1)
    } : undefined
    actions.canSwitch = key => key.endsWith('Tab') ? tabs.length > 1 : (tab?.panes.length ?? 0) > 1
    return () => { actions.toggle = undefined; actions.switch = undefined; actions.canSwitch = undefined }
  })

  function dragHeight(event) {
    const bottom = dock.current.getBoundingClientRect().bottom
    pointerDrag(event, next => change({ height: Math.max(144, Math.min(window.innerHeight * .76, bottom - next.clientY)) }))
  }

  function divider(part) {
    const { id, axis, ratio, bounds, style } = part
    const across = axis === 'x'
    const resize = value => updateTab(selected, entry => ({ ...entry, tree: resizeSplit(entry.tree, id, value) }))
    return h('div', {
      key: id, className: 'dbt-divider', 'data-axis': axis, style, role: 'separator', tabIndex: 0,
      'aria-label': t('resizeSplit'), 'aria-orientation': across ? 'vertical' : 'horizontal',
      'aria-valuemin': 18, 'aria-valuemax': 82, 'aria-valuenow': Math.round(ratio * 100),
      onPointerDown(event) {
        const rect = workspace.current.getBoundingClientRect()
        pointerDrag(event, next => resize(across
          ? ((next.clientX - rect.left) / rect.width * 100 - bounds.x) / bounds.width
          : ((next.clientY - rect.top) / rect.height * 100 - bounds.y) / bounds.height))
      },
      onKeyDown(event) {
        const back = across ? 'ArrowLeft' : 'ArrowUp'
        const forward = across ? 'ArrowRight' : 'ArrowDown'
        if (event.key !== back && event.key !== forward) return
        event.preventDefault()
        resize(ratio + (event.key === back ? -.05 : .05))
      },
    })
  }

  const theme = themes[preferences.theme]
  const rects = tab ? geometry(tab.tree) : null
  const atLimit = paneCount >= MAX_TERMINALS
  const closeSettings = () => { setSettings(false); settingsButton.current?.focus() }

  return h('section', {
    ref: dock, className: 'dsh-bottom-terminal', 'aria-label': t('bottomTerminal'), 'data-open': open,
    style: {
      '--dbt-bg': theme.terminal.background, '--dbt-fg': theme.terminal.foreground,
      '--dbt-bar': theme.chrome, '--dbt-border': theme.border, '--dbt-accent': theme.accent,
      '--dbt-height': preferences.height + 'px',
    },
  },
  open && h('div', {
    className: 'dbt-height', role: 'separator', tabIndex: 0, 'aria-label': t('resizePanel'),
    'aria-orientation': 'horizontal', onPointerDown: dragHeight,
    onKeyDown(event) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      change({ height: Math.max(144, Math.min(window.innerHeight * .76,
        dock.current.clientHeight + (event.key === 'ArrowUp' ? 24 : -24))) })
    },
  }),
  h('header', { className: 'dbt-bar' },
    h('button', { type: 'button', ref: button, className: 'dbt-title', onClick: toggle, 'aria-expanded': open },
      glyph('›_'), t('terminal'), glyph(open ? '⌄' : '⌃')),
    open && h('div', { className: 'dbt-tabs', role: 'tablist', 'aria-label': t('terminalTabs') },
      tabs.map(entry => h('div', { className: 'dbt-tab', key: entry.id, 'data-selected': selected === entry.id },
        h('button', {
          type: 'button', role: 'tab', 'aria-selected': selected === entry.id,
          onClick: () => { setSelected(entry.id); screens.get(entry.active)?.focus() },
        }, t('terminal') + ' ' + entry.id),
        tool(t('closeTab'), '×', () => closeTab(entry.id))))),
    open && h('div', { className: 'dbt-tools' },
      tool(atLimit ? t('limit') : t('newTab'), '+', addTab, { disabled: atLimit }),
      tool(t('splitRight'), '◫', () => addSplit('x'), { disabled: atLimit || !tab }),
      tool(t('splitDown'), '⬓', () => addSplit('y'), { disabled: atLimit || !tab }),
      tool(t('closePane'), '×', closePane, { disabled: !tab }),
      tool(t('appearance'), '⚙', () => setSettings(!settings), { ref: settingsButton, 'aria-expanded': settings }))),
  h('div', { className: 'dbt-workspace', hidden: !open, ref: workspace },
    tabs.flatMap(entry => entry.panes.map(pane => h(Pane, {
      key: pane.id, pane, t, preferences, screens,
      shown: open && entry.id === selected, active: entry.id === selected && entry.active === pane.id,
      style: entry.id === selected ? rects?.panes.get(pane.id) : undefined,
      select: selectPane, restart: () => restartPane(entry.id, pane.id),
    }))),
    open && rects?.dividers.map(divider),
    open && !tab && h('button', { className: 'dbt-empty', type: 'button', onClick: addTab }, t('newTab'))),
  open && settings && h(Settings, { preferences, change, close: closeSettings, t }))
}

export const inject = ['slots', 'locale', 'shortcuts']

export function apply(ctx) {
  const namespace = 'bottomTerminal'
  const actions = {}
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  const t = ctx.locale.bind(namespace)

  ctx.slots.inject('shell.bottom', () => ctx.slots.register({
    name: 'shell.bottom', locale: namespace,
  }, props => h(BottomTerminal, { ...props, actions })))

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = panelCss + '\n@scope (.dsh-bottom-terminal) {\n' + xtermCss + '\n}'
    document.head.append(style)
    function resolve(key, target) {
      if (key === 'toggle') return actions.toggle
      if (target?.closest('.xterm') && !target.closest('.dsh-bottom-terminal')) return undefined
      if (actions.switch && actions.canSwitch(key)) return () => actions.switch?.(key)
    }
    const disposers = []
    const linuxBindings = new Map()
    for (const [key, code] of shortcuts) {
      const webLinux = key.endsWith('Pane')
      const supported = webLinux ? [...profiles, 'web:linux'] : profiles
      const binding = { code, modifiers: ['primary', 'shift'] }
      try {
        disposers.push(ctx.shortcuts.register({
          id: 'bottom-terminal.' + key,
          label: () => t(key), aliases: ['terminal'],
          defaults: Object.fromEntries(supported.map(profile => [profile, binding])),
          regions: key === 'toggle' ? ['page', 'editable', 'terminal'] : ['page', 'terminal'],
          modals: [],
          resolve({ modal, target }) {
            const run = modal === null ? resolve(key, target) : undefined
            return run ? { status: 'handled', run } : { status: 'pass' }
          },
        }))
        if (!webLinux) linuxBindings.set(code, key)
      } catch (error) {
        console.warn('[bottom-terminal] Shortcut registration failed:', key, error)
      }
    }
    function linuxKeydown(event) {
      if (event.defaultPrevented || event.isComposing || event.repeat
        || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return
      const key = linuxBindings.get(event.code)
      const target = event.target instanceof Element ? event.target : null
      if (!key || target?.closest('[role="dialog"]')) return
      if (key !== 'toggle' && !target?.closest('.dsh-bottom-terminal')
        && target?.closest('input, textarea, [contenteditable="true"]')) return
      const run = resolve(key, target)
      if (!run) return
      event.preventDefault()
      event.stopPropagation()
      run()
    }
    const linuxWeb = ctx.shortcuts.runtime === 'web' && ctx.shortcuts.platform === 'linux'
    if (linuxWeb) window.addEventListener('keydown', linuxKeydown, true)
    return () => {
      if (linuxWeb) window.removeEventListener('keydown', linuxKeydown, true)
      for (const dispose of disposers) dispose()
      style.remove()
    }
  }, 'bottom-terminal: stylesheet and keyboard shortcuts')
}
