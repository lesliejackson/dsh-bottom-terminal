import { SHELLS } from './transport.js'

const defaultFont = '"JetBrainsMono Nerd Font", "Cascadia Mono", "JetBrains Mono", Consolas, monospace'
const storageKey = 'dsh.bottom-terminal.v1'

function palette(background, foreground, cursor, selectionBackground, colors) {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const ansi = Object.fromEntries(names.flatMap((name, index) => [
    [name, colors[index]], ['bright' + name[0].toUpperCase() + name.slice(1), colors[index + 8]],
  ]))
  return { background, foreground, cursor, cursorAccent: background, selectionBackground, ...ansi }
}

export const themes = {
  graphite: {
    label: 'Graphite', chrome: '#21242b', border: '#363b46', accent: '#8daeff',
    terminal: palette('#17191e', '#d9dfe9', '#d9dfe9', '#354569',
      ['#252731', '#ef7981', '#9ac899', '#e4c27e', '#91b5ff', '#c6a0ed', '#86ced5', '#d9dfe9',
        '#6d7586', '#ff9da3', '#b9dfa8', '#f5d89e', '#a8caff', '#dbb8ff', '#a2e4e8', '#f4f7ff']),
  },
  dracula: {
    label: 'Dracula', chrome: '#2d303e', border: '#45495c', accent: '#bd93f9',
    terminal: palette('#282a36', '#f8f8f2', '#f8f8f2', '#44475a',
      ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  },
  solarized: {
    label: 'Solarized Dark', chrome: '#073642', border: '#31515a', accent: '#66b4ef',
    terminal: palette('#002b36', '#aabcbf', '#93a1a1', '#264855',
      ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
        '#586e75', '#f67248', '#a1ac56', '#ddab3c', '#67b7ee', '#e888b9', '#67cdc2', '#fdf6e3']),
  },
  light: {
    label: 'Paper', chrome: '#eeefed', border: '#cbd0d2', accent: '#2456a1',
    terminal: palette('#fafaf8', '#25282e', '#25282e', '#cfdef6',
      ['#25282e', '#b52b3d', '#25683e', '#835809', '#2456a1', '#823681', '#176b73', '#595b63',
        '#51535a', '#ac243a', '#216642', '#7d5305', '#245ba9', '#89398d', '#146c73', '#353945']),
  },
}

export function readPreferences() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(storageKey)) }
  catch (error) { console.debug('[bottom-terminal] Preferences unavailable', error) }
  return {
    theme: Object.hasOwn(themes, saved?.theme) ? saved.theme : 'graphite',
    font: typeof saved?.font === 'string' ? saved.font.slice(0, 200) : defaultFont,
    fontSize: Number.isInteger(saved?.fontSize) && saved.fontSize >= 9 && saved.fontSize <= 32 ? saved.fontSize : 14,
    height: Number.isFinite(saved?.height) ? Math.min(1600, Math.max(144, saved.height)) : 300,
    renderer: saved?.renderer === 'dom' ? 'dom' : 'auto',
    shell: SHELLS.includes(saved?.shell) ? saved.shell : 'default',
  }
}

export function savePreferences(preferences) {
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)) }
  catch (error) { console.debug('[bottom-terminal] Preferences could not be saved', error) }
}

export function terminalFont(font) {
  return font.trim() ? font + ', monospace' : defaultFont
}
