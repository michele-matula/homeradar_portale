import { linkProps } from '../router';

const SUPPORT_EMAIL = 'matulamichele+homeradar@gmail.com';

/** Piè di pagina di tutte le pagine, accesso compreso. */
export function Footer() {
  return (
    <footer className="footer">
      <span>
        © {new Date().getFullYear()} HomeRadar · Dati conservati in UE
      </span>
      <nav className="footer__links" aria-label="Informazioni">
        <a {...linkProps('/informativa')}>Informativa privacy</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Assistenza</a>
      </nav>
    </footer>
  );
}
