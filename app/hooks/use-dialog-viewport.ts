import { useEffect, useState, type CSSProperties } from 'react';

/** Keep dialogs inside the visible viewport when a phone keyboard opens. */
export function useDialogViewport() {
  const [style, setStyle] = useState<CSSProperties>({});
  useEffect(() => {
    const viewport = window.visualViewport;
    function update() {
      setStyle({
        '--of-viewport-height': `${viewport?.height ?? window.innerHeight}px`,
        '--of-viewport-offset': `${viewport?.offsetTop ?? 0}px`,
      } as CSSProperties);
    }
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return style;
}
