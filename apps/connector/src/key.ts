// Chiave pubblica del manifest (non è un segreto): fissa l'ID dell'estensione, che il portale usa per parlarle.
// Generata con scripts/generate-key.mjs; alla pubblicazione si mette quella che dà il Web Store.
export const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArbyzxpdYmHaA0vUJAHq4u7dYSdwZFkiBRr6mL4Tkve1nAYjdwGdeDMqXuR5+tD5HzUMpN0ddIIR6fdOi63VpVLtO1SMDEuPsqtkxnUvlhHDG7NWXN10yQLumVWynX2NZyVqOSnmYrjapP+A8rzsPhYoFtayCvqPWUOZRVkrK98Wqj9cSEFJAoDym4AvdvZGTMQdtyW5kk4C1UiZJJ7rGuBlLuiInAxVR6Bx4JjQePtXIucBOScREPI1v7ZEvH5sZdM/cYFY8SrzbHv9qH9spws3OP7Ksa1fkXyF5wlaJrKYAKaFtIEwwOjTSxXFq7E5dZtDM5wuO3uOIe+IXY97w+QIDAQAB';

/** ID di Chrome per una chiave: SHA-256 del DER, primi 32 caratteri esadecimali scritti con le lettere a–p. */
export async function extensionId(key: string): Promise<string> {
  const der = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
