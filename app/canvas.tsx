import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import type { Slide, Asset, Layer } from './types';
import { layoutText } from '../player/web/text-layout.js';
import { resizeLayer } from './geometry.mjs';
import { imageStyle, panCrop } from '../player/web/image-layout.js';
import { counterText } from '../player/web/counter.js';
import { clockText } from '../player/web/clock.js';

function TextContent({
  layer,
  scale,
  text,
}: {
  layer: Layer;
  scale: number;
  text: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current?.parentElement)
      layoutText(ref.current.parentElement, ref.current, layer, scale);
  }, [layer, scale, text]);
  return <span ref={ref}>{text}</span>;
}

export function SlideCanvas({
  slide,
  assets,
  selected,
  onSelect,
  onMove,
  onDragStart,
  onResize,
  cropMode = false,
  onCrop,
  interactive = false,
}: {
  slide: Slide;
  assets: Asset[];
  selected?: string | null;
  interactive?: boolean;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onDragStart?: () => void;
  cropMode?: boolean;
  onCrop?: (id: string, crop: { cropX: number; cropY: number }) => void;
  onResize?: (
    id: string,
    geometry: Pick<Layer, 'x' | 'y' | 'width' | 'height'>,
  ) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [time, setTime] = useState(new Date());
  const live = slide.layers.some(
    (layer) => layer.type === 'clock' || layer.type === 'counter',
  );
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) =>
      setScale(entries[0].contentRect.width / slide.width),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [slide.width]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, [live]);
  function begin(e: PointerEvent<HTMLElement>, layer: Layer) {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    onSelect?.(layer.id);
    onDragStart?.();
    const rect = root.current!.getBoundingClientRect();
    const startX = e.clientX,
      startY = e.clientY;
    const el = e.currentTarget;
    const asset = assets.find((a) => a.id === layer.assetId);
    const cropping =
      cropMode &&
      selected === layer.id &&
      layer.type === 'image' &&
      layer.fit === 'cover' &&
      asset;
    el.setPointerCapture(e.pointerId);
    const move = (event: globalThis.PointerEvent) => {
      if (cropping) {
        onCrop?.(
          layer.id,
          panCrop(
            layer,
            event.clientX - startX,
            event.clientY - startY,
            (rect.width * layer.width) / 100,
            (rect.height * layer.height) / 100,
            asset.width,
            asset.height,
          ),
        );
        return;
      }
      const x = Math.max(
        0,
        Math.min(
          100 - layer.width,
          layer.x + ((event.clientX - startX) / rect.width) * 100,
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          100 - layer.height,
          layer.y + ((event.clientY - startY) / rect.height) * 100,
        ),
      );
      onMove?.(layer.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function beginResize(
    e: PointerEvent<HTMLButtonElement>,
    layer: Layer,
    corner: string,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onDragStart?.();
    const bounds = root.current!.getBoundingClientRect();
    const startX = e.clientX,
      startY = e.clientY,
      handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (event: globalThis.PointerEvent) =>
      onResize?.(
        layer.id,
        resizeLayer(
          layer,
          corner,
          ((event.clientX - startX) / bounds.width) * 100,
          ((event.clientY - startY) / bounds.height) * 100,
          layer.type === 'image' && layer.lockAspect !== false,
        ),
      );
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  const LayerElement = interactive ? 'button' : 'div';
  return (
    <div
      ref={root}
      className={`slide-canvas ${interactive ? 'editable' : ''}`}
      style={{
        aspectRatio: `${slide.width}/${slide.height}`,
        background: slide.background,
      }}
    >
      {interactive && (
        <button
          type="button"
          aria-label="Deselect layers"
          onClick={() => onSelect?.(null)}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            border: 0,
            borderRadius: 0,
          }}
        />
      )}
      {slide.layers.map((layer) => (
        <LayerElement
          key={layer.id}
          aria-label={interactive ? `Select ${layer.type} layer` : undefined}
          onClick={interactive ? () => onSelect?.(layer.id) : undefined}
          onPointerDown={interactive ? (e) => begin(e, layer) : undefined}
          className={`slide-layer ${selected === layer.id ? 'selected' : ''} ${cropMode && selected === layer.id ? 'cropping' : ''}`}
          style={{
            left: `${layer.x}%`,
            top: `${layer.y}%`,
            width: `${layer.width}%`,
            height: `${layer.height}%`,
            color: layer.color,
            fontSize: layer.fontSize * scale,
            fontWeight: layer.bold ? 700 : 400,
            textAlign: layer.align,
            padding: 0,
            border: 0,
            borderRadius: 0,
            background: 'transparent',
            display: 'block',
          }}
        >
          {layer.type === 'image' ? (
            <img
              draggable={false}
              alt=""
              src={assets.find((a) => a.id === layer.assetId)?.url}
              style={imageStyle(layer) as React.CSSProperties}
            />
          ) : (
            <TextContent
              layer={layer}
              scale={scale}
              text={
                layer.type === 'counter' && layer.counter
                  ? counterText(layer.counter, time.getTime())
                  : layer.type === 'clock'
                    ? clockText(layer.clock, time.getTime())
                    : layer.text
              }
            />
          )}
        </LayerElement>
      ))}
      {interactive &&
        !cropMode &&
        slide.layers
          .filter(
            (l) =>
              l.id === selected &&
              ['image', 'clock', 'counter'].includes(l.type),
          )
          .map((layer) =>
            (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <button
                key={corner}
                type="button"
                className={`resize-handle ${corner}`}
                aria-label={`Resize ${layer.type} ${{ nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' }[corner]}`}
                style={{
                  left: `${layer.x + (corner.includes('e') ? layer.width : 0)}%`,
                  top: `${layer.y + (corner.includes('s') ? layer.height : 0)}%`,
                }}
                onPointerDown={(e) => beginResize(e, layer, corner)}
                onKeyDown={(e) => {
                  if (
                    ![
                      'ArrowUp',
                      'ArrowDown',
                      'ArrowLeft',
                      'ArrowRight',
                    ].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  onDragStart?.();
                  const step = e.shiftKey ? 5 : 1;
                  onResize?.(
                    layer.id,
                    resizeLayer(
                      layer,
                      corner,
                      e.key === 'ArrowLeft'
                        ? -step
                        : e.key === 'ArrowRight'
                          ? step
                          : 0,
                      e.key === 'ArrowUp'
                        ? -step
                        : e.key === 'ArrowDown'
                          ? step
                          : 0,
                      layer.type === 'image' && layer.lockAspect !== false,
                    ),
                  );
                }}
              />
            )),
          )}
    </div>
  );
}
