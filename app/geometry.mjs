/** Resize relative to the opposite corner, in slide percentages. */
export function resizeLayer(layer, corner, dx, dy, locked = true) {
  const left = corner.includes('w'),
    top = corner.includes('n');
  const anchorX = left ? layer.x + layer.width : layer.x;
  const anchorY = top ? layer.y + layer.height : layer.y;
  const maxWidth = left ? anchorX : 100 - anchorX;
  const maxHeight = top ? anchorY : 100 - anchorY;
  let width = layer.width + (left ? -dx : dx);
  let height = layer.height + (top ? -dy : dy);
  if (locked) {
    const widthScale = width / layer.width,
      heightScale = height / layer.height;
    const requested =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const minimum = Math.max(1 / layer.width, 1 / layer.height);
    const scale = Math.max(
      minimum,
      Math.min(requested, maxWidth / layer.width, maxHeight / layer.height),
    );
    width = layer.width * scale;
    height = layer.height * scale;
  } else {
    width = Math.max(1, Math.min(width, maxWidth));
    height = Math.max(1, Math.min(height, maxHeight));
  }
  return {
    x: left ? anchorX - width : anchorX,
    y: top ? anchorY - height : anchorY,
    width,
    height,
  };
}

/**
 * Arrange within the selected group's bounds; outer edges stay fixed when
 * distributing equal gaps. Reject the whole operation if any layer is locked.
 * @template {{id: string, x: number, y: number, width: number, height: number, lockMode?: string}} T
 * @param {T[]} layers
 * @param {string[]} ids
 * @param {string} action
 * @returns {T[]}
 */
export function arrangeLayers(layers, ids, action) {
  const selected = layers.filter((layer) => ids.includes(layer.id));
  const distributing = action === 'horizontal' || action === 'vertical';
  if (
    selected.length < (distributing ? 3 : 2) ||
    selected.some((layer) => layer.lockMode && layer.lockMode !== 'none') ||
    ![
      'left',
      'center',
      'right',
      'top',
      'middle',
      'bottom',
      'horizontal',
      'vertical',
    ].includes(action)
  )
    return layers;
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(action);
  const position = horizontal ? 'x' : 'y';
  const size = horizontal ? 'width' : 'height';
  const low = Math.min(...selected.map((layer) => layer[position]));
  const high = Math.max(
    ...selected.map((layer) => layer[position] + layer[size]),
  );
  const positions = new Map();
  if (distributing) {
    const sorted = [...selected].sort((a, b) => a[position] - b[position]);
    const gap =
      (high - low - sorted.reduce((sum, layer) => sum + layer[size], 0)) /
      (selected.length - 1);
    // Don't turn a crowded selection into overlapping cards.
    if (gap < -1e-8) return layers;
    let next = low;
    for (const layer of sorted) {
      positions.set(layer.id, next);
      next += layer[size] + Math.max(0, gap);
    }
  } else {
    for (const layer of selected)
      positions.set(
        layer.id,
        action === 'left' || action === 'top'
          ? low
          : action === 'right' || action === 'bottom'
            ? high - layer[size]
            : (low + high - layer[size]) / 2,
      );
  }
  let changed = false;
  const result = layers.map((layer) => {
    if (
      !positions.has(layer.id) ||
      Math.abs(layer[position] - positions.get(layer.id)) < 1e-8
    )
      return layer;
    changed = true;
    return { ...layer, [position]: positions.get(layer.id) };
  });
  return changed ? result : layers;
}
