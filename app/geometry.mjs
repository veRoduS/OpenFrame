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
