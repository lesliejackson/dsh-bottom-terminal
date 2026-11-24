import assert from 'node:assert/strict'
import test from 'node:test'
import { geometry, leaf, leaves, removePane, resizeSplit, splitPane } from '../src/layout.js'

test('nested splits preserve pane identity, ordering and panel bounds', () => {
  const two = splitPane(leaf(1), 1, 2, 'x')
  const three = splitPane(two, 2, 3, 'y')
  const tree = resizeSplit(three, two.id, 0.6)
  assert.deepEqual(leaves(tree), [1, 2, 3])
  assert.deepEqual([...geometry(tree).panes], [
    [1, { left: '0%', top: '0%', width: '60%', height: '100%' }],
    [2, { left: '60%', top: '0%', width: '40%', height: '50%' }],
    [3, { left: '60%', top: '50%', width: '40%', height: '50%' }],
  ])
  assert.deepEqual(leaves(removePane(tree, 2)), [1, 3])
  assert.deepEqual(geometry(removePane(tree, 1)).panes.get(2),
    { left: '0%', top: '0%', width: '100%', height: '50%' })
})
