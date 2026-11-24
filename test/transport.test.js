import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { setImmediate as turn } from 'node:timers/promises'
import test from 'node:test'
import { serveTerminal } from '../src/transport.js'

class Socket extends EventEmitter {
  readyState = 1
  frames = []
  send(value, options) { this.frames.push(options?.binary ? value : JSON.parse(value)) }
  receive(frame) { this.emit('message', Buffer.from(JSON.stringify(frame)), false) }
  terminate() { this.close() }
  close() {
    if (this.readyState !== 1) return
    this.readyState = 3
    this.emit('close')
  }
}

function setup() {
  const ws = new Socket()
  const output = new PassThrough()
  const outcome = Promise.withResolvers()
  const operations = []
  const errors = []
  const handle = {
    output,
    done: outcome.promise,
    async write(data) { operations.push(['input', data]) },
    async resize(cols, rows) { operations.push(['resize', cols, rows]) },
    async terminate() { operations.push(['terminate']); output.end() },
  }
  const served = serveTerminal(ws, async request => {
    operations.push(['start', request])
    return { handle, shell: 'bash', cwd: '/workspace' }
  }, error => errors.push(error))
  return { ws, output, outcome, operations, served, errors }
}

test('streams raw bytes before exit and serializes input and resize', async () => {
  const { ws, output, outcome, operations, served, errors } = setup()
  ws.receive(['start', 120, 25, 'session-id', 'bash'])
  await turn()
  ws.receive(['resize', 100, 22])
  ws.receive(['input', 'hello\r'])
  await turn()
  const bytes = Buffer.from('世界\x1b[31m')
  output.write(bytes.subarray(0, 2))
  output.write(bytes.subarray(2))
  output.end()
  outcome.resolve({ exitCode: 0, signal: null })
  await served

  assert.deepEqual(operations, [
    ['start', { cols: 120, rows: 25, sessionId: 'session-id', shell: 'bash' }],
    ['resize', 100, 22], ['input', 'hello\r'], ['terminate'],
  ])
  assert.deepEqual(ws.frames, [['ready', 'bash', '/workspace'], bytes, ['exit', 0, null]])
  assert.deepEqual(errors, [])
})

test('pauses at the output watermark and resumes after client acknowledgement', async () => {
  const { ws, output, served, errors } = setup()
  ws.receive(['start', 120, 24, null, 'default'])
  await turn()
  const bytes = 256 * 1024
  const block = Buffer.alloc(16_384, 1)
  for (let sent = 0; sent < bytes * 2; sent += block.length) output.write(block)
  await turn()
  assert.equal(output.isPaused(), true)
  const sentBytes = () => ws.frames.filter(Buffer.isBuffer).reduce((total, data) => total + data.length, 0)
  assert.equal(sentBytes(), bytes)
  ws.receive(['ack', bytes])
  await turn()
  assert.equal(sentBytes(), bytes * 2)
  ws.close()
  await served
  assert.deepEqual(errors, [])
})

test('terminates a PTY that finishes allocating after its socket disconnects', async () => {
  const ws = new Socket()
  const startup = Promise.withResolvers()
  let ended = 0
  const output = new PassThrough()
  const served = serveTerminal(ws, () => startup.promise, assert.fail)
  ws.receive(['start', 80, 24, null, 'default'])
  ws.close()
  startup.resolve({
    handle: { output, done: Promise.resolve({}), async terminate() { ++ended; output.end() } },
    shell: 'bash',
    cwd: '/workspace',
  })
  await served
  assert.equal(ended, 1)
  assert.deepEqual(ws.frames, [])
})

test('rejects invalid dimensions before allocating a shell', async () => {
  const { ws, operations, served, errors } = setup()
  ws.receive(['start', 0, 24, null, 'default'])
  await served
  assert.deepEqual(operations, [])
  assert.deepEqual(ws.frames, [['error', 'Invalid terminal start request']])
  assert.deepEqual(errors, [])
})
