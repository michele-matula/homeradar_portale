// Una tantum: genera la chiave del manifest, che fissa l'ID dell'estensione caricata non pacchettizzata.
// Stampa solo la chiave pubblica (non è un segreto) e l'ID; la privata non serve e non si salva.
// Alla pubblicazione sul Web Store si sostituisce con la chiave pubblica che dà il Web Store.
import { createHash, generateKeyPairSync } from 'node:crypto';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
console.log(`MANIFEST_KEY = '${der.toString('base64')}'`);
console.log(`CONNECTOR_ID = '${id}'`);
