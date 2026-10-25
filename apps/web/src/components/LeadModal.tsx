import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Finestra del lead sopra la lista: si chiude con ✕, Esc o clic sullo sfondo (l'«indietro» del browser la chiude da sé,
 * perché cambia l'indirizzo). Mentre è aperta la pagina sotto non scorre e Tab resta dentro; chiusa, il fuoco torna dov'era.
 */
export function LeadModal({ onClose, position, children }: { onClose(): void; position: string | null; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab' && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);

  return (
    <div className="modal" data-testid="modal-backdrop" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="modal__box" role="dialog" aria-modal="true" aria-label="Scheda del lead" tabIndex={-1} ref={box}>
        <div className="modal__top">
          <span className="modal__position">{position}</span>
          <button type="button" className="modal__close" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
