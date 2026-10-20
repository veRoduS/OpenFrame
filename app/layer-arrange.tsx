import { useState } from 'react';
import { arrangeLayers } from './geometry.mjs';
import type { Layer } from './types';
import './layer-arrange.css';

export function LayerArrange({
  layers,
  ids,
  onChange,
}: {
  layers: Layer[];
  ids: string[];
  onChange: (layers: Layer[]) => void;
}) {
  const [message, setMessage] = useState('');
  const selected = layers.filter((layer) => ids.includes(layer.id));
  const locked = selected.some(
    (layer) => layer.lockMode === 'full' || layer.lockMode === 'movement',
  );
  function apply(action: string) {
    const next = arrangeLayers(layers, ids, action);
    if (next === layers)
      setMessage(
        'No change. Cards may already be arranged; even spacing needs enough room for every card.',
      );
    else {
      setMessage(
        'Arrangement applied. Use Undo to restore the previous layout.',
      );
      onChange(next);
    }
  }
  return (
    <section className="layer-arrange" aria-label="Arrange selected layers">
      <h3>Arrange selected layers</h3>
      <p>
        {selected.length} selected. Choose cards on the canvas or use the
        checkboxes in Layers.
      </p>
      <p>
        Align within the selection’s outer edges. Equal spacing keeps the
        outside cards in place.
      </p>
      {locked && (
        <output>Unlock the selected layers before arranging them.</output>
      )}
      <div className="layer-arrange-actions">
        {[
          ['left', 'Align left'],
          ['center', 'Align horizontal centers'],
          ['right', 'Align right'],
          ['top', 'Align top'],
          ['middle', 'Align vertical centers'],
          ['bottom', 'Align bottom'],
          ['horizontal', 'Space evenly horizontally'],
          ['vertical', 'Space evenly vertically'],
        ].map(([action, label]) => (
          <button
            type="button"
            key={action}
            disabled={
              locked ||
              selected.length <
                (action === 'horizontal' || action === 'vertical' ? 3 : 2)
            }
            onClick={() => apply(action)}
          >
            {label}
          </button>
        ))}
      </div>
      <output>{message}</output>
    </section>
  );
}
