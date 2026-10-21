// Crea l'account amministratore: chiede la password senza mostrarla e stampa il comando Wrangler da eseguire.
// Uso: node scripts/create-admin.mjs <email>   (per il database locale sostituisci --remote con --local)
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ITERATIONS = 100_000; // come src/crypto.ts
const b64url = (b) => Buffer.from(b).toString('base64url');

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

// Un solo readline per tutte le domande: con l'input da pipe un secondo readline non leggerebbe nulla.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
let muted = false;
rl._writeToOutput = (s) => {
  if (!muted) rl.output.write(s);
};

// L'iteratore tiene in coda le righe arrivate prima della domanda (input da pipe).
const lines = rl[Symbol.asyncIterator]();

async function askHidden(question) {
  process.stdout.write(question);
  muted = true;
  const { value } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  return value ?? '';
}

function stop(message) {
  console.error(message);
  rl.close();
  process.exit(1);
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) stop('Uso: node scripts/create-admin.mjs <email>');
const password = await askHidden('Password (almeno 10 caratteri): ');
if (password.length < 10 || password.length > 200) stop('La password deve avere da 10 a 200 caratteri');
if ((await askHidden('Ripeti la password: ')) !== password) stop('Le password non coincidono');
rl.close();

const now = Date.now();
const sql = `INSERT INTO users (id, email, password_hash, role, status, comuni, max_comuni, created_at, updated_at) VALUES ('${randomUUID()}', '${email.replace(/'/g, "''")}', '${await hashPassword(password)}', 'admin', 'active', '[]', 0, ${now}, ${now});\n`;
// L'SQL va in un file: nell'hash c'è "$", che la shell espanderebbe dentro un --command fra virgolette.
const file = path.join(mkdtempSync(path.join(tmpdir(), 'homeradar-admin-')), 'admin.sql');
writeFileSync(file, sql);
console.log('\nEsegui da apps/server, poi cancella il file:\n');
console.log(`npx wrangler d1 execute homeradar-portale --remote --file "${file}"`);
