import assert from 'node:assert/strict'
import test from 'node:test'
import { registerShortcuts } from '../src/shortcuts.js'

test('dock shortcuts are discoverable and keep their defaults out of the host registry', () => {
  const commands = new Map()
  const oldWindow = globalThis.window
  globalThis.window = new EventTarget()

  try {
    const dispose = registerShortcuts({
      runtime: 'desktop',
      platform: 'windows',
      register(command) {
        commands.set(command.id, command)
        return () => commands.delete(command.id)
      },
    }, (key, params) => params ? key + ':' + params.name + ':' + params.keys : key, {})

    const paneCommands = new Map([
      ['splitRight', 'Ctrl+Shift+1'],
      ['splitDown', 'Ctrl+Shift+2'],
      ['focusPaneLeft', 'Ctrl+Shift+←'],
      ['focusPaneRight', 'Ctrl+Shift+→'],
      ['focusPaneUp', 'Ctrl+Shift+↑'],
      ['focusPaneDown', 'Ctrl+Shift+↓'],
      ['togglePaneZoom', 'Ctrl+M'],
    ])
    for (const [key, alias] of paneCommands) {
      const command = commands.get('bottom-terminal.' + key)
      assert.deepEqual(command.defaults, {}, key)
      assert.ok(command.aliases.includes('分屏'), key)
      assert.ok(command.aliases.includes(alias), key)
      assert.equal(command.label(), 'paneCommand:' + key + ':' + alias)
    }
    assert.equal(commands.get('bottom-terminal.newTab').label(), 'newTab')
    assert.deepEqual(commands.get('bottom-terminal.newTab').defaults['desktop:windows'], {
      code: 'Backslash', modifiers: ['primary', 'shift'],
    })
    dispose()
    assert.equal(commands.size, 0)
  } finally {
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  }
})
