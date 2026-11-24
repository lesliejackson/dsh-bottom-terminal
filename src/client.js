import React from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import panelCss from './panel.css'
import { readPreferences, savePreferences, themes } from './appearance.js'
import { adjacentPane, geometry, leaf, leaves, removePane, resizeSplit, splitPane } from './layout.js'
import { mountScreen } from './screen.js'
import { SHELLS } from './transport.js'
import { registerShortcuts } from './shortcuts.js'
import { en, zh } from './labels.js'

const { createElement: h, useEffect, useLayoutEffect, useRef, useState } = React
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

function TabNameEditor({ name, t, save, cancel }) {
  const input = useRef(null)
  useLayoutEffect(() => {
    input.current.focus()
    input.current.select()
  }, [])

  return h('input', {
    className: 'dbt-tab-name', ref: input, defaultValue: name, maxLength: 64,
    'aria-label': t('tabName'), spellCheck: false, onBlur: cancel,
    onKeyDown(event) {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Enter') save(event.currentTarget.value)
      else cancel()
    },
  })
}

function BottomTerminal({ useSessions, t, actions }) {
  const sessionId = useSessions(selectedSession)
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [fullscreenMode, setFullscreenMode] = useState(false)
  const [settings, setSettings] = useState(false)
  const [tabs, setTabs] = useState([])
  const [selected, setSelected] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const counter = useRef(0)
  const screens = useRef(new Map()).current
  const wasOpen = useRef(false)
  const button = useRef(null)
  const settingsButton = useRef(null)
  const dock = useRef(null)
  const workspace = useRef(null)
  const fullscreen = open && fullscreenMode
  const tab = tabs.find(entry => entry.id === selected)
  const hasSplits = (tab?.panes.length ?? 0) > 1
  const zoomed = hasSplits && tab.zoomed
  const rects = tab ? geometry(tab.tree) : null

  function change(update) { setPreferences(current => ({ ...current, ...update })) }
  useEffect(() => { savePreferences(preferences) }, [preferences])

  function newPane() {
    return { id: ++counter.current, sessionId, shell: preferences.shell }
  }

  function addTab() {
    const pane = newPane()
    setTabs(current => [...current, { id: pane.id, tree: leaf(pane.id), active: pane.id, panes: [pane] }])
    setSelected(pane.id)
    setRenaming(null)
    setOpen(true)
  }

  function toggle() {
    if (!open && tabs.length === 0) { addTab(); return }
    setOpen(!open)
    if (open) {
      setRenaming(null)
      setSettings(false)
    }
  }

  function toggleFullscreen() {
    if (fullscreen) {
      setFullscreenMode(false)
      return
    }
    if (tabs.length === 0) addTab()
    else setOpen(true)
    setFullscreenMode(true)
  }

  function updateTab(id, update) {
    setTabs(current => current.map(entry => entry.id === id ? update(entry) : entry))
  }

  function selectPane(id) {
    if (tab && tab.active !== id) updateTab(selected, entry => ({ ...entry, active: id }))
  }

  function addSplit(axis) {
    const pane = newPane()
    updateTab(tab.id, entry => ({
      ...entry, tree: splitPane(entry.tree, entry.active, pane.id, axis),
      active: pane.id, panes: [...entry.panes, pane], zoomed: false,
    }))
  }

  function togglePaneZoom() {
    updateTab(tab.id, entry => ({ ...entry, zoomed: !entry.zoomed }))
  }

  function closeTab(id) {
    const index = tabs.findIndex(entry => entry.id === id)
    const next = tabs.filter(entry => entry.id !== id)
    setTabs(next)
    finishRename(id)
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
      ...entry, tree, active, panes: entry.panes.filter(pane => pane.id !== entry.active), zoomed: false,
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
    setRenaming(null)
    setSelected(next.id)
  }

  function switchPane(offset) {
    const ids = leaves(tab.tree)
    selectPane(circular(ids, ids.indexOf(tab.active), offset))
  }

  function focusAdjacentPane(direction) {
    const next = adjacentPane(rects.paneBounds, tab.active, direction)
    if (next !== undefined) selectPane(next)
  }

  function beginRename(id) {
    setSettings(false)
    setSelected(id)
    setRenaming(id)
  }

  function finishRename(id) {
    setRenaming(current => current === id ? null : current)
  }

  function renameTab(id, value) {
    updateTab(id, entry => ({ ...entry, name: value.trim() || undefined }))
    finishRename(id)
  }

  useLayoutEffect(() => {
    const collapsed = wasOpen.current && !open
    wasOpen.current = open
    if (collapsed) {
      const document = button.current.ownerDocument
      const composer = document.querySelector('[data-slot="main.conversation"] [data-composer-input][contenteditable="true"]')
      composer?.focus({ preventScroll: true })
      if (!composer || document.activeElement !== composer) button.current.focus()
    } else if (open && tab && !settings && renaming === null) {
      screens.get(tab.active)?.focus()
    }
  }, [open, selected, tab?.active, fullscreen, zoomed, settings, renaming, screens])

  useLayoutEffect(() => {
    const canSwitchTabs = open && tabs.length > 1
    const canSwitchPanes = open && hasSplits
    const canUsePaneShortcuts = open && tab && !settings && renaming === null
    actions.current = {
      toggle,
      newTab: addTab,
      closeActiveTab: canUsePaneShortcuts ? () => closeTab(tab.id) : undefined,
      fullscreen: toggleFullscreen,
      previousTab: canSwitchTabs ? () => switchTab(-1) : undefined,
      nextTab: canSwitchTabs ? () => switchTab(1) : undefined,
      previousPane: canSwitchPanes ? () => switchPane(-1) : undefined,
      nextPane: canSwitchPanes ? () => switchPane(1) : undefined,
      splitRight: canUsePaneShortcuts ? () => addSplit('x') : undefined,
      splitDown: canUsePaneShortcuts ? () => addSplit('y') : undefined,
      ...(canUsePaneShortcuts && hasSplits ? {
        focusPaneLeft: () => focusAdjacentPane('left'),
        focusPaneRight: () => focusAdjacentPane('right'),
        focusPaneUp: () => focusAdjacentPane('up'),
        focusPaneDown: () => focusAdjacentPane('down'),
        togglePaneZoom,
      } : {}),
    }
    return () => { actions.current = undefined }
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
  const closeSettings = () => { setSettings(false); settingsButton.current?.focus() }

  function tabButton(entry) {
    const name = entry.name ?? t('terminal') + ' ' + entry.id
    return h('div', { className: 'dbt-tab', key: entry.id, 'data-selected': selected === entry.id },
      renaming === entry.id
        ? h(TabNameEditor, {
          name, t, save: value => renameTab(entry.id, value), cancel: () => finishRename(entry.id),
        })
        : h('button', {
          type: 'button', role: 'tab', title: name, 'aria-selected': selected === entry.id,
          onClick: () => { setSelected(entry.id); screens.get(entry.active)?.focus() },
          onDoubleClick: () => beginRename(entry.id),
          onKeyDown(event) {
            if (event.key !== 'F2') return
            event.preventDefault()
            beginRename(entry.id)
          },
        }, name),
      tool(t('closeTab'), '×', () => closeTab(entry.id)))
  }

  return h('section', {
    ref: dock, className: 'dsh-bottom-terminal', 'aria-label': t('bottomTerminal'), 'data-open': open,
    'data-fullscreen': fullscreen || undefined,
    'data-pane-zoomed': zoomed || undefined,
    style: {
      '--dbt-bg': theme.terminal.background, '--dbt-fg': theme.terminal.foreground,
      '--dbt-bar': theme.chrome, '--dbt-border': theme.border, '--dbt-accent': theme.accent,
      '--dbt-height': preferences.height + 'px',
    },
  },
  open && !fullscreen && h('div', {
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
      tabs.map(tabButton)),
    open && h('div', { className: 'dbt-tools' },
      tool(t('newTab'), '+', addTab),
      tool(t('splitRight'), '◫', () => addSplit('x'), { disabled: !tab }),
      tool(t('splitDown'), '⬓', () => addSplit('y'), { disabled: !tab }),
      hasSplits && tool(t(zoomed ? 'restorePane' : 'zoomPane'), zoomed ? '⊟' : '⊞', togglePaneZoom,
        { 'aria-pressed': !!zoomed }),
      tool(t('renameTab'), '✎', () => beginRename(tab.id), { disabled: !tab }),
      tool(t('closePane'), '×', closePane, { disabled: !tab }),
      tool(t(fullscreen ? 'restorePanel' : 'expandPanel'), fullscreen ? '↙' : '⛶', toggleFullscreen),
      tool(t('appearance'), '⚙', () => setSettings(!settings), { ref: settingsButton, 'aria-expanded': settings }))),
  h('div', { className: 'dbt-workspace', hidden: !open, ref: workspace },
    tabs.flatMap(entry => entry.panes.map(pane => h(Pane, {
      key: pane.id, pane, t, preferences, screens,
      shown: open && entry.id === selected && (!zoomed || entry.active === pane.id),
      active: entry.id === selected && entry.active === pane.id,
      style: entry.id === selected && !zoomed ? rects.panes.get(pane.id) : undefined,
      select: selectPane, restart: () => restartPane(entry.id, pane.id),
    }))),
    open && !zoomed && rects?.dividers.map(divider),
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
    const unregister = registerShortcuts(ctx.shortcuts, t, actions)
    return () => {
      unregister()
      style.remove()
    }
  }, 'bottom-terminal: stylesheet and keyboard shortcuts')
}
