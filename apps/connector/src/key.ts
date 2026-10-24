// Chiave pubblica del manifest (non è un segreto): fissa l'ID dell'estensione, che il portale usa per parlarle.
// È la chiave pubblica del Web Store (dashboard → Pacchetto → «Visualizza chiave pubblica»), così le build locali hanno lo stesso ID dello Store.
export const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAonMrXVOaTZNgA5NlZEW95CF7X1GyWByjHIgjoIS0cSOjHI5JgrQ9fzb0Nwp55GSN6djsYuJg1HA8Ic8RfH7eIRymq+nWzgKMaHnS9kQ/4XU75pBtW3V4RDDIxehR1C4LO7hDjrEbkO99dZhP3b+Pd/OnAzo9EPUo8KqoDLqnQ8o5bd9ynvyN84EvDDQCXT1De1cVoEK+RFnVFK2E25UicThhur5K59ybKPp6eExxvC/qM3dn15AQ6Wj1weHf8bU3F4Z1Zm4XUROFIIIC+w2pFdk6cEN6RQ04yaa9yKBxDMmXr+/AyWFldoKswspMqmnMwEbwBPJyOKRmsHSj2WcT3wIDAQAB';

/** ID di Chrome per una chiave: SHA-256 del DER, primi 32 caratteri esadecimali scritti con le lettere a–p. */
export async function extensionId(key: string): Promise<string> {
  const der = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
