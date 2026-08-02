'use client';

import { useEffect } from 'react';

export default function MobileSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mobile-sheet-backdrop" onPointerDown={(event) => { event.stopPropagation(); onClose(); }}>
      <section
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mobile-sheet-grip" aria-hidden="true" />
        <header className="mobile-sheet-head">
          <strong>{title}</strong>
          <button className="mobile-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="mobile-sheet-body">{children}</div>
      </section>
    </div>
  );
}
