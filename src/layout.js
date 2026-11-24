// Panes are siblings in the DOM. Changing the split tree only changes their
// rectangles, so splitting or collapsing a branch cannot remount a terminal.
export function leaf(id) {
  return { id }
}

export function leaves(node) {
  return node.first ? [...leaves(node.first), ...leaves(node.second)] : [node.id]
}

export function splitPane(node, target, next, axis) {
  if (!node.first) {
    return node.id === target
      ? { id: 'split-' + next, axis, ratio: 0.5, first: node, second: leaf(next) }
      : node
  }
  return {
    ...node,
    first: splitPane(node.first, target, next, axis),
    second: splitPane(node.second, target, next, axis),
  }
}

export function removePane(node, target) {
  if (!node.first) return node.id === target ? null : node
  const first = removePane(node.first, target)
  const second = removePane(node.second, target)
  return first && second ? { ...node, first, second } : first ?? second
}

export function resizeSplit(node, id, ratio) {
  if (!node.first) return node
  if (node.id === id) return { ...node, ratio: Math.max(0.18, Math.min(0.82, ratio)) }
  return { ...node, first: resizeSplit(node.first, id, ratio), second: resizeSplit(node.second, id, ratio) }
}

export function geometry(node) {
  const panes = new Map()
  const dividers = []
  function place(part, x, y, width, height) {
    if (!part.first) {
      panes.set(part.id, { left: x + '%', top: y + '%', width: width + '%', height: height + '%' })
      return
    }
    const bounds = { x, y, width, height }
    if (part.axis === 'x') {
      const firstWidth = width * part.ratio
      dividers.push({ ...part, bounds, style: { left: x + firstWidth + '%', top: y + '%', height: height + '%' } })
      place(part.first, x, y, firstWidth, height)
      place(part.second, x + firstWidth, y, width - firstWidth, height)
    } else {
      const firstHeight = height * part.ratio
      dividers.push({ ...part, bounds, style: { left: x + '%', top: y + firstHeight + '%', width: width + '%' } })
      place(part.first, x, y, width, firstHeight)
      place(part.second, x, y + firstHeight, width, height - firstHeight)
    }
  }
  place(node, 0, 0, 100, 100)
  return { panes, dividers }
}
