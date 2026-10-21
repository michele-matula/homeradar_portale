// Crea l'account amministratore: chiede la password senza mostrarla e stampa il comando Wrangler da eseguire.
// Uso: node scripts/create-admin.mjs <email>   (per il database locale sostituisci --remote con --local)
import { randomUUID, webcrypto } from 'node:crypto';
import readline from 'node:readline';

const ITERATIONS = 100_000; // come src/crypto.ts
const b64url = (b) => Buffer.from(b).toString('base64url');

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: node scripts/create-admin.mjs <email>');
  process.exit(1);
}
const password = await askHidden('Password (almeno 10 caratteri): ');
if (password.length < 10 || password.length > 200) {
  console.error('La password deve avere da 10 a 200 caratteri');
  process.exit(1);
}
if ((await askHidden('Ripeti la password: ')) !== password) {
  console.error('Le password non coincidono');
  process.exit(1);
}
const now = Date.now();
const sql = `INSERT INTO users (id, email, password_hash, role, status, comuni, max_comuni, created_at, updated_at) VALUES ('${randomUUID()}', '${email.replace(/'/g, "''")}', '${await hashPassword(password)}', 'admin', 'active', '[]', 0, ${now}, ${now})`;
console.log('\nEsegui da apps/server:\n');
console.log(`npx wrangler d1 execute homeradar-portale --remote --command "${sql}"`);
