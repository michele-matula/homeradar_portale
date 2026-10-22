import { useState } from 'react';

/**
 * Miniatura del lead: prova le copertine in ordine e, se nessuna si carica, mostra un riquadro neutro della stessa
 * misura. La foto arriva dal server immagini del portale solo quando si vede, senza referrer.
 * Chi la usa la monta con `key` sulle copertine, così un elenco nuovo riparte dalla prima.
 */
export function Cover({ covers, href, size = 'small' }: {
  /** Copertine in ordine di preferenza (`LeadView.covers`). */
  covers: string[];
  /** Annuncio principale, aperto al clic; senza, la miniatura non è un link (sta già dentro un link). */
  href?: string;
  size?: 'small' | 'large';
}) {
  const [index, setIndex] = useState(0);
  const src = covers[index];
  const className = `cover cover--${size}${src ? '' : ' cover--empty'}`;
  const content = src ? (
    <img
      key={src}
      className="cover__img"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setIndex((i) => i + 1)}
    />
  ) : (
    <span className="cover__none" aria-hidden="true">⌂</span>
  );
  return href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer" aria-label="Apri l'annuncio">
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}
