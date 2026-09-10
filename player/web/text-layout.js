/** Find the largest fitting font size, to quarter-pixel precision. */
export function fitFontSize(fits, maximum) {
  let low = 0.25,
    high = Math.max(low, maximum);
  for (let attempt = 0; attempt < 20 && high - low > 0.25; attempt++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** Shared by the management canvas and the offline player. */
export function layoutText(box, content, layer, scale) {
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.justifyContent = {
    top: 'flex-start',
    middle: 'center',
    bottom: 'flex-end',
  }[layer.verticalAlign || 'top'];
  Object.assign(content.style, {
    display: 'block',
    flexShrink: '0',
    width: '100%',
    lineHeight: '1.15',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    minWidth: '0',
  });
  if (
    !layer.autoSize ||
    !content.textContent?.trim() ||
    !box.clientWidth ||
    !box.clientHeight
  ) {
    content.style.fontSize = `${layer.fontSize * scale}px`;
    return;
  }
  const size = fitFontSize((candidate) => {
    content.style.fontSize = `${candidate}px`;
    return (
      content.scrollWidth <= box.clientWidth &&
      content.scrollHeight <= box.clientHeight
    );
  }, box.clientHeight / 1.15);
  content.style.fontSize = `${size}px`;
}
