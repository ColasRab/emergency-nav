"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
export default function AppSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null),
    titleId = useId(),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null,
      previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button,select,input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href]",
            ) ?? [],
          ).filter((n) => n.offsetParent !== null),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", key);
      previousFocus?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="app-sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className="app-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            className="sheet-close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ×
          </button>
        </header>
        <div className="app-sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
