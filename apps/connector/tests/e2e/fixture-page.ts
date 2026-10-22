const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Result = { realEstate: { id: number; title: string } };

/** Pagina di ricerca di Immobiliare con i dati in __NEXT_DATA__, come la serve il sito (da ../homeradar). */
export function buildSearchHtml(nextData: { props: { pageProps: { dehydratedState: { queries: { state: { data: { results: Result[] } } }[] } } } }): string {
  const results = nextData.props.pageProps.dehydratedState.queries[0]!.state.data.results;
  const cards = results
    .map((r) => `<li><div class="nd-slideshow__content"><img src="${GIF}" width="150" height="100"></div><a href="https://www.immobiliare.it/annunci/${r.realEstate.id}/">${esc(r.realEstate.title)}</a></li>`)
    .join('');
  const json = JSON.stringify(nextData).replace(/</g, '\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>
<ul id="list">${cards}</ul>
<script id="__NEXT_DATA__" type="application/json">${json}</script>
</body></html>`;
}
