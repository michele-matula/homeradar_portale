// E2E del portale: SPA compilata, D1 locale nuovo in .e2e-state (migrazioni + admin + annunci di prova), poi Playwright.
// Il Worker lo avvia Playwright (webServer in playwright.config.ts) sullo stesso stato.
import { execSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.resolve(web, '../server');
const state = path.join(web, '.e2e-state');
export const ADMIN = { email: 'admin@homeradar.test', password: 'password-e2e-admin' };

const ITERATIONS = 100_000; // come apps/server/src/crypto.ts
const b64url = (b) => Buffer.from(b).toString('base64url');
async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });

run('npm run build', web);
rmSync(state, { recursive: true, force: true });
run(`npx wrangler d1 migrations apply homeradar-portale --local --persist-to "${state}"`, server);

const now = Date.now();
const DAY = 86_400_000;
const listings = [
  ['immobiliare', 1001, 'https://www.immobiliare.it/annunci/1001/', 'Trilocale in centro'],
  ['idealista', 1002, 'https://www.idealista.it/immobile/1002/', 'Villa con giardino'],
  ['subito', 1003, 'https://www.subito.it/appartamenti/bilocale-luminoso-treviglio-1003.htm', 'Bilocale luminoso'],
];
const sql = [
  `INSERT INTO users (id, email, password_hash, role, status, comuni, max_comuni, created_at, updated_at) VALUES ('${randomUUID()}', '${ADMIN.email}', '${await hashPassword(ADMIN.password)}', 'admin', 'active', '[]', 0, ${now}, ${now});`,
  ...listings.map(([portal, id, url, title], i) =>
    `INSERT INTO listings (key, portal, portal_id, url, title, city, city_norm, scope_istat, category, surface_m2, rooms, current_price, portal_created_at, first_seen_at, last_seen_at, seen_count) VALUES ('${portal}:${id}', '${portal}', ${id}, '${url}', '${title}', 'Treviglio', 'treviglio', '016219', 'residential', 80, 3, ${150_000 + i * 50_000}, ${now - 200 * DAY}, ${now - DAY}, ${now}, 1);`),
].join('\n');
// L'SQL va in un file: nell'hash c'è "$", che la shell espanderebbe.
const file = path.join(mkdtempSync(path.join(tmpdir(), 'homeradar-e2e-')), 'seed.sql');
writeFileSync(file, sql);
run(`npx wrangler d1 execute homeradar-portale --local --persist-to "${state}" --file "${file}"`, server);
rmSync(path.dirname(file), { recursive: true, force: true });

run(`npx playwright test ${process.argv.slice(2).join(' ')}`, web);
