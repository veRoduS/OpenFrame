// Geometry is expressed in source-slide pixels, shared by editor and players.
export function shapeGeometry(layer, slide) {
  const width = (slide.width * layer.width) / 100;
  const height = (slide.height * layer.height) / 100;
  const config = layer.shape || {};
  const stroke = Math.min(config.outlineWidth || 0, width, height);
  const inset = stroke / 2;
  const radius = Math.min(
    config.cornerRadius || 0,
    Math.max(0, (Math.min(width, height) - stroke) / 2),
  );
  return {
    width,
    height,
    tag: config.kind === 'circle' ? 'circle' : 'rect',
    attributes: {
      ...(config.kind === 'circle'
        ? {
            cx: width / 2,
            cy: height / 2,
            r: Math.max(0, (Math.min(width, height) - stroke) / 2),
          }
        : {
            x: inset,
            y: inset,
            width: Math.max(0, width - stroke),
            height: Math.max(0, height - stroke),
            rx: radius,
            ry: radius,
          }),
      fill: config.fillEnabled === false ? 'none' : config.fill || '#17613d',
      stroke: config.outline || '#202923',
      'stroke-width': stroke,
    },
  };
}
export function renderShape(element, layer, slide) {
  const geometry = shapeGeometry(layer, slide);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-shape', layer.shape?.kind || 'rectangle');
  Object.assign(svg.style, { display: 'block', width: '100%', height: '100%' });
  const shape = document.createElementNS(
    'http://www.w3.org/2000/svg',
    geometry.tag,
  );
  for (const [key, value] of Object.entries(geometry.attributes))
    shape.setAttribute(key, String(value));
  svg.append(shape);
  element.replaceChildren(svg);
}
