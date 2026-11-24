import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const output = resolve(root, 'lib')
await mkdir(output, { recursive: true })

await Promise.all([
  build({
    absWorkingDir: root, entryPoints: ['src/client.js'], outfile: 'lib/client.js',
    bundle: true, minify: true, target: 'chrome118', legalComments: 'eof',
    format: 'iife', globalName: 'bottomTerminalPlugin', loader: { '.css': 'text' },
    banner: { js: "window.__ModuleLoader__.load({id:'@local/dsh-bottom-terminal',factory(require){const dshReact=require('react');" },
    footer: { js: 'return bottomTerminalPlugin}});' },
    plugins: [{
      name: 'dsh-react',
      setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'dsh' }))
        builder.onLoad({ filter: /^react$/, namespace: 'dsh' }, () => ({ contents: 'module.exports = dshReact' }))
      },
    }],
  }),
  build({
    absWorkingDir: root, stdin: { contents: "module.exports = require('ws')", resolveDir: root },
    outfile: 'lib/ws.cjs', platform: 'node', format: 'cjs',
    bundle: true, minify: true, target: 'node22', legalComments: 'eof',
    external: ['bufferutil', 'utf-8-validate'],
  }),
])

const licenses = await Promise.all(['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl', 'ws'].map(async pkg => {
  // All four packages place their main file at the root or one directory below it.
  const entry = require.resolve(pkg)
  const manifest = /[\\/]lib[\\/]/.test(entry) ? resolve(dirname(entry), '..') : dirname(entry)
  return pkg + '\n\n' + await readFile(resolve(manifest, 'LICENSE'), 'utf8')
}))
await writeFile(resolve(output, 'THIRD-PARTY-LICENSES.txt'), licenses.join('\n\n'))
