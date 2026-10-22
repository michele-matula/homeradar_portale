import { Layout } from '../components/Layout';

const CONTACT = 'matulamichele@gmail.com';

/** Informativa per la fase di prova: dice in breve cosa fa il connettore e cosa arriva al portale. Pubblica (la apre anche il Web Store). */
export function Privacy() {
  return (
    <Layout>
      <article className="card">
        <h1>Informativa (versione di prova)</h1>
        <p>Questa è la versione per la fase di prova di HomeRadar. Il testo completo arriverà prima dell'apertura del servizio.</p>

        <h2>Cosa fa il connettore</h2>
        <p>
          Il connettore è l'estensione di Chrome che fa il giro delle ricerche. Legge Immobiliare.it, Idealista, Subito e CasaDaPrivato solo
          durante un giro che lanci tu dal portale con «Cerca», e solo nella scheda aperta per quel giro. Fuori dal giro non legge né manda
          niente.
        </p>
        <p>
          Su Immobiliare.it e Subito una piccola parte del connettore lavora dentro le pagine del sito, in ogni scheda: passa al resto del
          connettore i dati che il sito ha già caricato. Restano nella pagina, visibili anche agli script del sito, e il connettore li usa solo
          durante il giro, nella scheda del giro.
        </p>

        <h2>Cosa arriva al portale</h2>
        <p>
          Solo annunci di privati, e di ognuno solo: link, titolo, indirizzo, comune e zona, tipologia, superficie, locali, prezzo e ribassi,
          data dell'annuncio, foto di copertina. Mai numeri di telefono né nomi dei venditori.
        </p>
        <p>
          Gli annunci formano un archivio condiviso fra gli agenti della stessa zona. Stati, note, richiami e impostazioni sono solo tuoi:
          nessun altro li vede.
        </p>

        <h2>Cos'altro registra il portale</h2>
        <p>
          I computer collegati (nome del browser e del sistema, versione del connettore, ultimo uso) e gli errori del portale e del connettore,
          ripuliti dai dati degli annunci e tenuti 90 giorni.
        </p>

        <h2>Contatti</h2>
        <p>
          Per domande o per chiedere la cancellazione dei tuoi dati: Michele Matula, <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </article>
    </Layout>
  );
}
