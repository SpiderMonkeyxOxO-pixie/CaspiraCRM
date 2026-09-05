import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Traps Tab/Shift+Tab focus cycling within a modal/dialog container and
// restores focus to whatever triggered it on unmount. Escape handling is
// left to the caller (via onEscape) since some dialogs need to confirm
// before actually closing.
export default function useFocusTrap(active, onEscape) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    triggerRef.current = document.activeElement;

    const container = containerRef.current;
    const focusables = () => Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape" && onEscape) {
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return containerRef;
}
