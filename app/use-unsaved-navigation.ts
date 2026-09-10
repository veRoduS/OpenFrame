import { useEffect, useRef, useState } from 'react';

export function useUnsavedNavigation(dirty: boolean, onClose: () => void) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const owner = useRef(`editor-${Math.random().toString(36).slice(2)}`);
  const pushed = useRef(false);
  const leaving = useRef(false);
  const continuation = useRef<(() => void) | null>(null);
  const latest = useRef({ dirty, onClose });
  latest.current = { dirty, onClose };
  function finish() {
    if (leaving.current) return;
    leaving.current = true;
    setConfirmOpen(false);
    if (history.state?.openframeEditor === owner.current) history.back();
    else (continuation.current || latest.current.onClose)();
  }
  function requestLeave(action?: () => void) {
    continuation.current = action || latest.current.onClose;
    if (latest.current.dirty) setConfirmOpen(true);
    else finish();
  }
  const requestRef = useRef(requestLeave);
  requestRef.current = requestLeave;
  useEffect(() => {
    const ownerId = owner.current;
    const original = history.state;
    // StrictMode replays effects; reuse the guard entry on the second setup.
    history[pushed.current ? 'replaceState' : 'pushState'](
      { ...original, openframeEditor: owner.current },
      '',
      location.href,
    );
    pushed.current = true;
    function onPop() {
      if (leaving.current) {
        (continuation.current || latest.current.onClose)();
        return;
      }
      if (history.state?.openframeEditor === owner.current) return;
      history.pushState(
        { ...history.state, openframeEditor: owner.current },
        '',
        location.href,
      );
      requestRef.current();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (latest.current.dirty && !leaving.current) event.preventDefault();
    }
    function onLink(event: MouseEvent) {
      const anchor =
        event.target instanceof Element
          ? (event.target.closest('a[href]') as HTMLAnchorElement | null)
          : null;
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      event.preventDefault();
      requestRef.current(() => location.assign(anchor.href));
    }
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onLink, true);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onLink, true);
      if (history.state?.openframeEditor === ownerId)
        history.replaceState(original, '', location.href);
    };
  }, []);
  return {
    confirmOpen,
    requestLeave,
    leave: finish,
    cancel: () => {
      continuation.current = null;
      setConfirmOpen(false);
    },
  };
}
