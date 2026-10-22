const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Toglie dai percorsi del portale, ovunque compaiano in un testo, i segreti e le chiavi: token d'invito e di
 * reimpostazione, chiavi dei lead, id. Gli errori della stessa pagina si raggruppano e non portano dati.
 */
export function scrubPaths(text: string): string {
  return text
    .replace(/\/api\/tokens\/[^\s/?#:]+/g, '/api/tokens/:token')
    .replace(/\/(attiva|reimposta)\/[^\s/?#:]+/g, '/$1/:token')
    .replace(/\/lead\/[^\s/?#]+/g, '/lead/:chiave')
    .replace(UUID, ':id');
}
