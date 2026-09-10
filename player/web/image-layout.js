export function imageStyle(layer) {
  const x = layer.fit === 'cover' ? (layer.cropX ?? 50) : 50,
    y = layer.fit === 'cover' ? (layer.cropY ?? 50) : 50;
  return {
    objectFit: layer.fit,
    objectPosition: `${x}% ${y}%`,
    transform: layer.fit === 'cover' ? `scale(${layer.cropZoom ?? 1})` : 'none',
    transformOrigin: `${x}% ${y}%`,
  };
}

export function panCrop(
  layer,
  dx,
  dy,
  boxWidth,
  boxHeight,
  imageWidth,
  imageHeight,
) {
  const zoom = layer.cropZoom ?? 1;
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight) * zoom;
  const overflowX = imageWidth * scale - boxWidth,
    overflowY = imageHeight * scale - boxHeight;
  const clamp = (value) => Math.max(0, Math.min(100, value));
  return {
    cropX:
      overflowX > 0.1
        ? clamp((layer.cropX ?? 50) - (dx / overflowX) * 100)
        : 50,
    cropY:
      overflowY > 0.1
        ? clamp((layer.cropY ?? 50) - (dy / overflowY) * 100)
        : 50,
  };
}
