/** Voci della barra delle pagine: tutte fino a 7, altrimenti prima, ultima e le vicine alla corrente, con `null` per «…». */
export function pageItems(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  return [1, ...(start > 2 ? [null] : []), ...Array.from({ length: end - start + 1 }, (_, i) => start + i), ...(end < pages - 1 ? [null] : []), pages];
}

/** Numeri di pagina sotto la lista; niente se c'è una pagina sola. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage(p: number): void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagine">
      <button type="button" className="pager__btn" aria-label="Pagina precedente" disabled={page === 1} onClick={() => onPage(page - 1)}>‹</button>
      {pageItems(page, pages).map((p, i) =>
        p == null ? (
          <span key={`gap-${i}`} className="pager__gap" aria-hidden="true">…</span>
        ) : (
          <button key={p} type="button" className={`pager__btn${p === page ? ' pager__btn--on' : ''}`} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
            {p}
          </button>
        ),
      )}
      <button type="button" className="pager__btn" aria-label="Pagina successiva" disabled={page === pages} onClick={() => onPage(page + 1)}>›</button>
    </nav>
  );
}
