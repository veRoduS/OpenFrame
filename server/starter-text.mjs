export const starterText = 'Something worth\nsharing.';

export function isUntouchedStarter(layer) {
  return (
    layer.type === 'text' &&
    layer.starterText === true &&
    layer.text === starterText
  );
}

// A removed marker stays removed, even if an edited message is later reverted.
export function trackStarterText(slide, previous) {
  return {
    ...slide,
    layers: slide.layers.map((layer) => {
      const prior = previous?.layers.find((item) => item.id === layer.id);
      if (
        isUntouchedStarter(layer) &&
        (!previous || isUntouchedStarter(prior || {}))
      )
        return layer;
      const { starterText: _starterText, ...content } = layer;
      return content;
    }),
  };
}

export function removeUntouchedStarter(slide) {
  return {
    ...slide,
    layers: slide.layers.filter((layer) => !isUntouchedStarter(layer)),
  };
}
