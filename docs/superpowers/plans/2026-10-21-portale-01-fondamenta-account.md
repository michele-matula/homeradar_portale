# Portale, tappa 1: fondamenta e account — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo con la logica pura dell'estensione, Worker Cloudflare con D1 che gestisce account (inviti, accesso, sessioni, reimpostazione password, sospensione) e un portale React minimo con accesso, attivazione dell'account e pagina admin degli utenti.

**Architecture:** Workspace npm: `packages/shared` (logica pura copiata da `homeradar`, più tipi e schemi delle API), `apps/server` (Worker: API JSON sotto `/api/*`, D1, serve la SPA come asset statici), `apps/web` (SPA React compilata con Vite in `apps/web/dist`, servita dal Worker). Sessioni con cookie `HttpOnly` e token salvati solo come hash.

**Tech Stack:** TypeScript 7, npm workspaces, zod 4, Cloudflare Workers + D1 + static assets, Wrangler 4, `@cloudflare/vitest-plugin`, React 19, Vite, Vitest 5, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§4 Componenti, §5 "Account e servizio", §6.1 Invito e accesso, §6.7 Admin, §7, §8). Modello per Worker e test: `../homeradar/worker/` (il Worker del pilota).

## Global Constraints

- Testi dell'interfaccia e messaggi d'errore in italiano.
- Timestamp sempre in ms epoch UTC.
- Repository pubblico: nessun segreto nel codice; segreti con `wrangler secret`, in locale `.dev.vars` (ignorato).
- D1 creato con `--jurisdiction eu`.
- Il server non fa mai richieste verso i portali immobiliari.
- Password: PBKDF2-SHA256 di WebCrypto, 100 000 iterazioni (il massimo ammesso dai Workers), sale 16 byte, hash 32 byte.
- Token (invito, reimpostazione, sessione): 32 byte casuali in base64url; nel database solo lo SHA-256 in esadecimale.
- Sessione: cookie `hr_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, durata 30 giorni, rinnovata a 30 giorni quando ne mancano meno di 15.
- Invito valido 7 giorni, reimpostazione 1 ora, entrambi monouso.
- Password da 10 a 200 caratteri.
- Limite comuni di default per agente: 4 (`config.default_max_comuni`), modificabile per utente dall'admin.
- Email confrontate sempre dopo `trim().toLowerCase()`.
- Errori delle API: corpo `{ "error": "<messaggio in italiano>" }` con lo stato HTTP adatto.
- Il Worker richiede il piano Workers Paid (PBKDF2 a 100 000 iterazioni supera i 10 ms di CPU del piano gratuito).

## Review Focus

1. Email scritta con maiuscole o spazi all'accesso o alla creazione ("  Mario@Rossi.IT ") → è lo stesso utente; creare due volte la stessa email dà 409. Test nei Task 4, 5 e 6.
2. Link d'invito aperto di nuovo dopo l'uso, scaduto o rigenerato dall'admin → "Link non valido o scaduto", nessuna seconda attivazione. Test nei Task 4, 5 e 6.
3. Agente sospeso con una sessione ancora aperta → la richiesta successiva risponde 403 "Account sospeso" e il cookie viene cancellato. Test nei Task 5 e 6.
4. Admin che assegna un comune inesistente, duplicato o oltre il limite → 400 con messaggio chiaro, nulla salvato. Test nel Task 6.
5. POST da un'altra origine (CSRF) o agente che chiama `/api/admin/*` → 403. Test nei Task 3 e 6.

---

## Struttura dei file

```
package.json                    workspace radice (packages/*, apps/*), script test/typecheck/build
tsconfig.base.json              opzioni comuni (strict, noUncheckedIndexedAccess, Bundler)
packages/shared/
  package.json                  "@homeradar/shared", exports "./*": "./src/*.ts" (+ "./shared/comuni.json")
  src/core/*.ts                 logica pura copiata (vedi Task 1)
  src/adapters/**               adattatori copiati
  src/shared/*.ts, comuni.json  tipi e formati copiati
  src/api/types.ts              tipi e schemi zod delle API del portale (Task 2)
  tests/**                      test copiati, fixture, test privacy
  scripts/sanitize-fixture.mjs  copiato
apps/server/
  wrangler.toml, vitest.config.ts, tsconfig.json
  migrations/0001_accounts.sql
  src/index.ts                  dispatch: /api/* → router, resto → env.ASSETS
  src/env.ts                    interfaccia Env
  src/http.ts                   json(), fail(), readBody(), sameOrigin()
  src/crypto.ts                 password e token
  src/users.ts                  query su users e tokens
  src/session.ts                sessioni e cookie
  src/rate-limit.ts             tentativi di accesso
  src/routes/auth.ts            login, logout, me, token
  src/routes/admin-users.ts     admin utenti
  scripts/create-admin.mjs      crea l'account admin
  test/*.test.ts
apps/web/
  package.json, vite.config.ts, vitest.config.ts, index.html
  src/main.tsx, App.tsx, router.ts, api.ts, styles.css
  src/pages/Login.tsx, TokenPage.tsx, Home.tsx, Privacy.tsx, AdminUsers.tsx
  src/components/ComunePicker.tsx
  test/*.test.tsx
docs/deploy.md
CLAUDE.md
```

Nei sorgenti di `packages/shared` gli import sono **relativi** (niente alias `@/`), così server e web li importano come `@homeradar/shared/core/comuni` senza configurare alias. I test di `packages/shared` mantengono l'alias `@/` → `packages/shared/src` nella loro `vitest.config.ts`.

---

### Task 1: Monorepo e logica condivisa

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Copy da `../homeradar`: `src/core/*.ts` **tranne** `db.ts`, `service.ts`, `backup.ts`, `auto-backup.ts`, `onboarding.ts`, `pilot-store.ts`, `router.ts`, `action-badge.ts`; tutto `src/adapters/`; `src/shared/*` **tranne** `messages.ts`, `report-config.ts`, `logo.ts`, `badge-style.ts`; `tests/unit/core`, `tests/unit/adapters`, `tests/unit/shared` (stessi esclusi, più `helpers.ts` e i test di `service.*`, `db`, `backup*`, `auto-backup`, `onboarding`, `pilot-store`, `router`, `action-badge`, `messages`, `report-schema-sync`); `tests/fixtures/`; `scripts/sanitize-fixture.mjs`.
- Test: i test copiati in `packages/shared/tests/`

**Interfaces:**
- Produces: pacchetto `@homeradar/shared`; ogni modulo importabile come `@homeradar/shared/<cartella>/<file>` (per esempio `@homeradar/shared/core/comuni` con `searchComuni`, `comuneInfo`, `toRef`; `@homeradar/shared/shared/types` con `ComuneRef`; `@homeradar/shared/core/report` con `sanitizeError`).

- [ ] **Step 1: Crea la radice del workspace**

`package.json` con `"private": true`, `"type": "module"`, `"workspaces": ["packages/*", "apps/*"]` e gli script `test` (`npm test --workspaces --if-present`), `typecheck` (idem), `build` (`npm run build -w apps/web`). `tsconfig.base.json` con `target ES2022`, `module ES2022`, `moduleResolution Bundler`, `strict`, `noUncheckedIndexedAccess`, `skipLibCheck`, `noEmit`, `resolveJsonModule`, `allowImportingTsExtensions` assente.

- [ ] **Step 2: Copia i file elencati e riscrivi gli import**

Nei sorgenti copiati in `packages/shared/src`, sostituisci ogni `from '@/…'` con il percorso relativo equivalente (uno script Node usa e getta va bene, da non salvare). I test restano con `@/`.

- [ ] **Step 3: Sistema le dipendenze rotte dei test**

Esegui `npm install` e poi `npx vitest run` in `packages/shared`. Un test che importa un modulo escluso va cancellato se il suo soggetto è escluso. Se invece importa solo un builder (per esempio `backup-builders.ts` usato da `missing.test.ts`), copia il builder e togli le parti che dipendono da moduli esclusi. Non modificare la logica dei moduli copiati.
Dipendenze di `packages/shared`: `zod`; dev: `vitest`, `jsdom`, `typescript`, `@types/node`.

- [ ] **Step 4: Verifica**

Run: `npm test -w packages/shared` e `npm run typecheck -w packages/shared`
Expected: tutti i test passano (il test privacy delle fixture compreso), typecheck senza errori.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: monorepo e logica condivisa copiata dall'estensione"
```

---

### Task 2: Tipi e schemi delle API

**Files:**
- Create: `packages/shared/src/api/types.ts`
- Test: `packages/shared/tests/unit/api/types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Role = 'agent' | 'admin';
  export type UserStatus = 'invited' | 'active' | 'suspended';
  export const PRIVACY_VERSION = 1;
  export const PASSWORD_MIN = 10, PASSWORD_MAX = 200;
  export const PASSWORD_TOO_SHORT = 'La password deve avere almeno 10 caratteri';
  export interface Me { id: string; email: string; role: Role; comuni: ComuneRef[] }
  export interface AdminUser { id: string; email: string; role: Role; status: UserStatus; comuni: ComuneRef[]; maxComuni: number; createdAt: number; lastSeenAt: number | null }
  export interface TokenInfo { kind: 'invite' | 'reset'; email: string }
  export const normalizeEmail: (s: string) => string;            // trim + toLowerCase
  export const LoginBody: z.ZodType<{ email: string; password: string }>;
  export const TokenBody: z.ZodType<{ password: string; privacyVersion?: number }>;
  export const CreateUserBody: z.ZodType<{ email: string; comuni: string[]; maxComuni?: number }>;
  export const UpdateUserBody: z.ZodType<{ comuni?: string[]; maxComuni?: number; status?: 'active' | 'suspended' }>;
  ```
  Tutti gli schemi sono `z.strictObject`. `email` passa da `normalizeEmail` ed è validata come email; `password` ha lunghezza da `PASSWORD_MIN` a `PASSWORD_MAX` con messaggio `PASSWORD_TOO_SHORT` sotto il minimo; `comuni` sono stringhe di 6 cifre; `maxComuni` è un intero da 1 a 30.

- [ ] **Step 1: Test che falliscono**

```ts
it('normalizza l\'email', () => expect(LoginBody.parse({ email: '  Mario@Rossi.IT ', password: 'x'.repeat(10) }).email).toBe('mario@rossi.it'));
it('rifiuta password corte', () => expect(TokenBody.safeParse({ password: 'corta' }).error?.issues[0]?.message).toBe(PASSWORD_TOO_SHORT));
it('rifiuta campi non dichiarati', () => expect(LoginBody.safeParse({ email: 'a@b.it', password: 'x'.repeat(10), role: 'admin' }).success).toBe(false));
it('rifiuta codici ISTAT malformati', () => expect(CreateUserBody.safeParse({ email: 'a@b.it', comuni: ['15059'] }).success).toBe(false));
it('maxComuni fra 1 e 30', () => expect(UpdateUserBody.safeParse({ maxComuni: 0 }).success).toBe(false));
```

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run tests/unit/api` → FAIL, modulo assente.
- [ ] **Step 3: Implementa `src/api/types.ts`** con le firme sopra.
- [ ] **Step 4: Verifica che passino** — stesso comando → PASS.
- [ ] **Step 5: Commit** — `feat(shared): tipi e schemi delle API del portale`

---

### Task 3: Worker, D1 e base HTTP

**Files:**
- Create: `apps/server/package.json`, `wrangler.toml`, `tsconfig.json`, `vitest.config.ts`, `migrations/0001_accounts.sql`, `src/index.ts`, `src/env.ts`, `src/http.ts`, `test/apply-migrations.ts`, `test/env.d.ts`, `test/http.test.ts`
- Modello: `../homeradar/worker/` (stessa configurazione di `@cloudflare/vitest-plugin` con `readD1Migrations` e `TEST_MIGRATIONS`).

**Interfaces:**
- Produces:
  ```ts
  // env.ts
  export interface Env { DB: D1Database; ASSETS: Fetcher }
  // http.ts
  export function json(data: unknown, status?: number, headers?: HeadersInit): Response;
  export function fail(status: number, error: string): Response;        // { error }
  export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response>; // 400 con il primo messaggio zod, 415 se non application/json
  export function sameOrigin(req: Request): boolean;                     // header Origin uguale all'origine di req.url
  export type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;
  export function route(method: string, pattern: string, h: Handler): { method: string; match(path: string): Record<string, string> | null; h: Handler };
  ```
  `index.ts`: per `/api/*` prova le rotte registrate (in questo task solo `GET /api/health` → `{ ok: true }`); rotta assente → 404 `{ error: 'Non trovato' }`; per ogni metodo diverso da GET/HEAD senza `sameOrigin` → 403 `{ error: 'Origine non ammessa' }`; un'eccezione non gestita → 500 `{ error: 'Errore interno' }`. Il resto passa a `env.ASSETS.fetch(req)`.

`wrangler.toml`: `name = "homeradar-portale"`, `main = "src/index.ts"`, `compatibility_date = "2026-10-01"`, D1 `binding = "DB"`, `database_name = "homeradar-portale"`, `migrations_dir = "migrations"`, assets `directory = "../web/dist"`, `binding = "ASSETS"`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*"]`. `database_id` provvisorio finché non si crea il database (Task 9).

`migrations/0001_accounts.sql`:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('agent','admin')),
  status TEXT NOT NULL CHECK (status IN ('invited','active','suspended')),
  comuni TEXT NOT NULL DEFAULT '[]',          -- JSON: codici ISTAT
  max_comuni INTEGER NOT NULL,
  privacy_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX tokens_user ON tokens(user_id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_email ON login_attempts(email, at);
CREATE INDEX login_attempts_ip ON login_attempts(ip, at);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO config (key, value) VALUES ('freshness_minutes', '60'), ('default_max_comuni', '4');
```

- [ ] **Step 1: Test che falliscono** (`test/http.test.ts`, con `SELF.fetch` o `exports.default.fetch` come nel Worker del pilota)

```ts
it('health', async () => expect(await (await fetchApi('GET', '/api/health')).json()).toEqual({ ok: true }));
it('rotta assente', async () => expect((await fetchApi('GET', '/api/nulla')).status).toBe(404));
it('POST da un\'altra origine', async () => {
  const r = await fetchApi('POST', '/api/health', {}, { Origin: 'https://evil.example' });
  expect(r.status).toBe(403);
  expect(await r.json()).toEqual({ error: 'Origine non ammessa' });
});
it('config iniziale', async () => expect((await env.DB.prepare("SELECT value FROM config WHERE key='freshness_minutes'").first())?.value).toBe('60'));
```
`fetchApi(method, path, body?, headers?)` è un helper in `test/helpers.ts`: imposta `Origin` uguale a `https://portale.test` (sovrascrivibile), `Content-Type: application/json` e restituisce la `Response`.

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/server` → FAIL.
- [ ] **Step 3: Implementa** configurazione, migrazione, `env.ts`, `http.ts`, `index.ts`.
- [ ] **Step 4: Verifica che passino** — stesso comando → PASS; `npm run typecheck -w apps/server` pulito.
- [ ] **Step 5: Commit** — `feat(server): Worker con D1 e base HTTP`

---

### Task 4: Password, token e utenti

**Files:**
- Create: `apps/server/src/crypto.ts`, `apps/server/src/users.ts`, `apps/server/scripts/create-admin.mjs`
- Test: `apps/server/test/crypto.test.ts`, `apps/server/test/users.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // crypto.ts
  export async function hashPassword(password: string): Promise<string>;   // "pbkdf2$100000$<salt b64url>$<hash b64url>"
  export async function verifyPassword(password: string, stored: string): Promise<boolean>; // confronto a tempo costante
  export function newToken(): string;                                      // 32 byte base64url
  export async function hashToken(token: string): Promise<string>;         // SHA-256 hex
  // users.ts
  export interface UserRow { id: string; email: string; passwordHash: string | null; role: Role; status: UserStatus; comuni: string[]; maxComuni: number; privacyVersion: number | null; createdAt: number; updatedAt: number; lastSeenAt: number | null }
  export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null>;   // normalizza l'email
  export async function findUserById(db: D1Database, id: string): Promise<UserRow | null>;
  export async function insertUser(db: D1Database, u: { email: string; role: Role; comuni: string[]; maxComuni: number }, now: number): Promise<UserRow>; // status 'invited', id crypto.randomUUID(); lancia EmailTaken se esiste
  export class EmailTaken extends Error {}
  export async function issueToken(db: D1Database, userId: string, kind: 'invite' | 'reset', now: number): Promise<string>; // invalida (used_at = now) i token non usati dello stesso tipo; scadenza 7 giorni / 1 ora
  export async function readToken(db: D1Database, token: string, now: number): Promise<{ user: UserRow; kind: 'invite' | 'reset' } | null>; // null se assente, usato o scaduto
  export async function consumeToken(db: D1Database, token: string, now: number): Promise<void>;
  export const INVITE_TTL_MS = 7 * 86_400_000, RESET_TTL_MS = 3_600_000;
  export function toComuneRefs(istat: string[]): ComuneRef[];             // da comuneInfo + toRef, scarta i codici sconosciuti
  ```
  `create-admin.mjs <email>`: chiede la password su stdin (senza eco), calcola l'hash con lo stesso formato usando `node:crypto` (`webcrypto.subtle`), stampa l'istruzione `wrangler d1 execute homeradar-portale --remote --command "INSERT …"` da eseguire, con `role 'admin'`, `status 'active'`, `max_comuni` 0. Non esegue nulla da solo.

- [ ] **Step 1: Test che falliscono**

```ts
it('verifica la password giusta e rifiuta quella sbagliata', async () => {
  const h = await hashPassword('password-lunga');
  expect(h).toMatch(/^pbkdf2\$100000\$/);
  expect(await verifyPassword('password-lunga', h)).toBe(true);
  expect(await verifyPassword('password-lungA', h)).toBe(false);
});
it('due hash della stessa password sono diversi', async () => expect(await hashPassword('x'.repeat(10))).not.toBe(await hashPassword('x'.repeat(10))));
it('email duplicata con maiuscole e spazi', async () => {
  await insertUser(env.DB, { email: 'mario@rossi.it', role: 'agent', comuni: [], maxComuni: 4 }, 1);
  await expect(insertUser(env.DB, { email: ' Mario@Rossi.IT ', role: 'agent', comuni: [], maxComuni: 4 }, 2)).rejects.toBeInstanceOf(EmailTaken);
  expect((await findUserByEmail(env.DB, 'MARIO@rossi.it '))?.email).toBe('mario@rossi.it');
});
it('token: valido, poi usato', async () => {
  const u = await insertUser(env.DB, { email: 'a@b.it', role: 'agent', comuni: [], maxComuni: 4 }, 0);
  const t = await issueToken(env.DB, u.id, 'invite', 0);
  expect((await readToken(env.DB, t, 1))?.kind).toBe('invite');
  await consumeToken(env.DB, t, 2);
  expect(await readToken(env.DB, t, 3)).toBeNull();
});
it('token scaduto', async () => { /* issueToken a 0, readToken a INVITE_TTL_MS + 1 → null */ });
it('un nuovo invito invalida il precedente', async () => { /* t1, t2 = issueToken ×2 → readToken(t1) null, readToken(t2) valido */ });
it('nel database solo l\'hash del token', async () => { /* SELECT token_hash: diverso dal token, uguale a hashToken(token) */ });
```

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run test/crypto.test.ts test/users.test.ts` (in `apps/server`) → FAIL.
- [ ] **Step 3: Implementa** `crypto.ts`, `users.ts`, `create-admin.mjs`.
- [ ] **Step 4: Verifica che passino** → PASS.
- [ ] **Step 5: Commit** — `feat(server): password, token e utenti`

---

### Task 5: Sessioni, accesso e link monouso

**Files:**
- Create: `apps/server/src/session.ts`, `apps/server/src/rate-limit.ts`, `apps/server/src/routes/auth.ts`; modifica `src/index.ts` (registra le rotte)
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 3 (`json`, `fail`, `readBody`, `route`), Task 4 (utenti, token, password), Task 2 (`LoginBody`, `TokenBody`, `Me`, `TokenInfo`, `PRIVACY_VERSION`).
- Produces:
  ```ts
  // session.ts
  export const SESSION_COOKIE = 'hr_session', SESSION_TTL_MS = 30 * 86_400_000, RENEW_BELOW_MS = 15 * 86_400_000;
  export async function createSession(db: D1Database, userId: string, now: number): Promise<string>;   // restituisce l'header Set-Cookie
  export function clearCookie(): string;
  export type AuthResult = { user: UserRow; setCookie?: string } | Response;   // Response = 401/403 già pronta
  export async function authenticate(req: Request, env: Env, now: number): Promise<AuthResult>;
  //   nessun cookie o sessione assente/scaduta → 401 { error: 'Accesso richiesto' }
  //   utente sospeso → 403 { error: 'Account sospeso' } con clearCookie()
  //   sessione con meno di RENEW_BELOW_MS → nuova scadenza e setCookie
  //   aggiorna users.last_seen_at al più una volta ogni 10 minuti
  export async function endSessions(db: D1Database, userId: string): Promise<void>;
  // rate-limit.ts
  export const MAX_FAILS_EMAIL = 5, MAX_FAILS_IP = 20, WINDOW_MS = 15 * 60_000;
  export async function tooManyAttempts(db: D1Database, email: string, ip: string, now: number): Promise<boolean>;
  export async function recordFailure(db: D1Database, email: string, ip: string, now: number): Promise<void>;
  export async function clearFailures(db: D1Database, email: string): Promise<void>;
  ```
  Rotte (`routes/auth.ts`):
  - `POST /api/login` `LoginBody` → 200 `{ user: Me }` + cookie. Errori: 429 `Troppi tentativi: riprova fra qualche minuto` (controllato prima della password), 401 `Email o password errati` (stesso messaggio per email sconosciuta, utente invitato senza password o password sbagliata; registra il fallimento), 403 `Account sospeso`. IP da `CF-Connecting-IP` (in test assente → `'unknown'`).
  - `POST /api/logout` → 204, cancella la sessione corrente, `clearCookie()`.
  - `GET /api/me` → `{ user: Me }`; `Me.comuni` da `toComuneRefs`.
  - `GET /api/tokens/:token` → `TokenInfo`, oppure 404 `Link non valido o scaduto`.
  - `POST /api/tokens/:token` `TokenBody`:
    - invito: `privacyVersion` deve essere `PRIVACY_VERSION`, altrimenti 400 `Devi accettare l'informativa`; imposta hash della password, `status 'active'`, `privacy_version`; consuma il token; crea la sessione → `{ user: Me }`;
    - reimpostazione: imposta la password, chiude tutte le sessioni dell'utente, consuma il token, crea una nuova sessione → `{ user: Me }`; utente sospeso → 403 `Account sospeso`.
    - Token non valido → 404 come sopra. Le scritture dell'attivazione stanno in un solo `db.batch`.

- [ ] **Step 1: Test che falliscono** (helper `cookieFrom(res)`, `invite(email)` che inserisce l'utente ed emette il token direttamente con le funzioni del Task 4)

```ts
it('attivazione completa e accesso', async () => {
  const t = await invite('mario@rossi.it');
  expect(await (await fetchApi('GET', `/api/tokens/${t}`)).json()).toEqual({ kind: 'invite', email: 'mario@rossi.it' });
  const r = await fetchApi('POST', `/api/tokens/${t}`, { password: 'password-lunga', privacyVersion: PRIVACY_VERSION });
  expect(r.status).toBe(200);
  expect(r.headers.get('Set-Cookie')).toMatch(/hr_session=.+HttpOnly; Secure; SameSite=Lax/);
  const login = await fetchApi('POST', '/api/login', { email: ' MARIO@rossi.it', password: 'password-lunga' });
  expect(login.status).toBe(200);
});
it('informativa non accettata', async () => { /* POST senza privacyVersion → 400 'Devi accettare l\'informativa', utente ancora 'invited' */ });
it('link usato due volte', async () => { /* seconda POST → 404 'Link non valido o scaduto'; GET idem */ });
it('password sbagliata ed email sconosciuta: stesso messaggio', async () => { /* entrambi 401 'Email o password errati' */ });
it('utente invitato non può accedere', async () => { /* login prima dell'attivazione → 401 */ });
it('dopo 5 errori sulla stessa email: 429 anche con la password giusta', async () => { /* 5 × errata, poi giusta → 429 */ });
it('me senza cookie', async () => expect((await fetchApi('GET', '/api/me')).status).toBe(401));
it('sospeso con sessione aperta', async () => {
  /* attiva, prendi il cookie, UPDATE users SET status='suspended' → GET /api/me: 403 'Account sospeso', Set-Cookie con Max-Age=0 */
});
it('sessione rinnovata quando ne mancano meno di 15 giorni', async () => { /* expires_at a now + 10 giorni → GET /api/me ha Set-Cookie e expires_at ≈ now + 30 giorni */ });
it('logout chiude la sessione', async () => { /* POST /api/logout → 204; GET /api/me col vecchio cookie → 401 */ });
it('reimpostazione chiude le altre sessioni', async () => { /* due sessioni, issueToken reset, POST nuova password → la vecchia sessione dà 401, la vecchia password 401, la nuova 200 */ });
```

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run test/auth.test.ts` → FAIL.
- [ ] **Step 3: Implementa** `session.ts`, `rate-limit.ts`, `routes/auth.ts`, registrazione in `index.ts`.
- [ ] **Step 4: Verifica che passino** → PASS (tutta la suite del server).
- [ ] **Step 5: Commit** — `feat(server): accesso, sessioni e link monouso`

---

### Task 6: Admin utenti (API)

**Files:**
- Create: `apps/server/src/routes/admin-users.ts`; modifica `src/index.ts`
- Test: `apps/server/test/admin-users.test.ts`

**Interfaces:**
- Consumes: `authenticate` (Task 5), funzioni utenti e token (Task 4), `CreateUserBody`, `UpdateUserBody`, `AdminUser` (Task 2), `comuneInfo` da `@homeradar/shared/core/comuni`.
- Produces: rotte admin. Tutte passano da `requireAdmin(req, env, now): Promise<{ user: UserRow; setCookie?: string } | Response>` (401 come `authenticate`, 403 `Riservato all'amministratore` per un agente).
  - `GET /api/admin/users` → `{ users: AdminUser[] }` ordinati per email.
  - `POST /api/admin/users` `CreateUserBody` → 201 `{ user: AdminUser, inviteUrl: string }`; `maxComuni` di default da `config.default_max_comuni`; `inviteUrl` = `${origine della richiesta}/attiva/${token}`; 409 `Esiste già un utente con questa email`.
  - `PATCH /api/admin/users/:id` `UpdateUserBody` → `{ user: AdminUser }`. `status` ammesso solo fra `active` e `suspended` (da `invited` → 400 `L'utente non ha ancora attivato l'account`); passando a `suspended` chiude le sue sessioni.
  - `POST /api/admin/users/:id/invite` → `{ inviteUrl }` solo se `invited`, altrimenti 400 `L'account è già attivo`.
  - `POST /api/admin/users/:id/reset` → `{ resetUrl }` (`/reimposta/${token}`) solo se `active`, altrimenti 400 `L'account non è attivo`.
  - `DELETE /api/admin/users/:id` → 204 (sessioni e token se ne vanno in cascata).
  - Su un utente `admin` le rotte `PATCH`, `reset` e `DELETE` rispondono 400 `L'account amministratore non si modifica da qui`. Utente assente → 404 `Utente non trovato`.
  - Regole sui comuni (creazione e modifica), controllate nell'ordine: codice sconosciuto (`comuneInfo` null) → 400 `Comune sconosciuto: <codice>`; duplicati → 400 `Comune ripetuto`; più di `maxComuni` (quello nuovo se nel corpo, altrimenti quello salvato) → 400 `Al massimo <n> comuni per questo utente`.

- [ ] **Step 1: Test che falliscono** (helper `loginAs(role)` che crea un utente attivo e restituisce il cookie)

```ts
it('un agente non entra nell\'admin', async () => expect((await fetchApi('GET', '/api/admin/users', undefined, { Cookie: await loginAs('agent') })).status).toBe(403));
it('crea un agente con il link d\'invito', async () => {
  const r = await post('/api/admin/users', { email: ' Luca@Bianchi.it', comuni: ['015059'] });
  expect(r.status).toBe(201);
  const { user, inviteUrl } = await r.json();
  expect(user).toMatchObject({ email: 'luca@bianchi.it', status: 'invited', maxComuni: 4, comuni: [{ istat: '015059' }] });
  expect(inviteUrl).toMatch(/^https:\/\/portale\.test\/attiva\/[A-Za-z0-9_-]{43}$/);
});
it('email già presente', async () => { /* seconda creazione → 409 */ });
it('comune sconosciuto, ripetuto, oltre il limite', async () => {
  /* ['999999'] → 'Comune sconosciuto: 999999'; ['015059','015059'] → 'Comune ripetuto'; 5 comuni validi con maxComuni default → 'Al massimo 4 comuni per questo utente'; dopo ogni errore GET mostra l'utente invariato */
});
it('alzare il limite e aggiungere comuni nella stessa richiesta', async () => { /* PATCH { maxComuni: 6, comuni: 6 validi } → 200 */ });
it('sospendere chiude le sessioni', async () => { /* agente attivo con cookie, PATCH status suspended → /api/me 403 */ });
it('nuovo invito invalida il vecchio', async () => { /* POST invite → vecchio link 404, nuovo valido */ });
it('reset solo per account attivi', async () => { /* utente invited → 400 'L\'account non è attivo' */ });
it('eliminare cancella sessioni e token', async () => { /* DELETE → 204; COUNT sessions/tokens per quell'id = 0 */ });
it('l\'admin non si elimina', async () => { /* DELETE sul proprio id → 400 */ });
```

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run test/admin-users.test.ts` → FAIL.
- [ ] **Step 3: Implementa** `routes/admin-users.ts` e la registrazione.
- [ ] **Step 4: Verifica che passino** → PASS, tutta la suite del server.
- [ ] **Step 5: Commit** — `feat(server): admin utenti`

---

### Task 7: Portale minimo — accesso e attivazione

**Files:**
- Create: `apps/web/package.json`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`, `src/router.ts`, `src/api.ts`, `src/styles.css`, `src/pages/Login.tsx`, `src/pages/TokenPage.tsx`, `src/pages/Home.tsx`, `src/pages/Privacy.tsx`
- Test: `apps/web/test/login.test.tsx`, `apps/web/test/token.test.tsx`

**Interfaces:**
- Consumes: tipi e schemi del Task 2; API dei Task 5-6.
- Produces:
  ```ts
  // api.ts — unico punto che parla col server
  export class ApiError extends Error { status: number }
  export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>; // credentials 'same-origin', JSON; errore → ApiError col messaggio del server
  // router.ts — nessuna libreria di routing
  export function usePath(): string;              // segue history.pushState e popstate
  export function navigate(path: string): void;
  ```
  Pagine: `/accedi` (Login), `/attiva/:token` e `/reimposta/:token` (TokenPage, modalità dal percorso), `/informativa` (Privacy: titolo "Informativa", testo provvisorio "Testo in preparazione: verrà pubblicato prima dell'apertura del servizio."), `/` (Home: "Ciao <email>. Qui troverai i tuoi lead.", elenco dei comuni assegnati, pulsante «Esci»; per l'admin anche il link «Utenti»), `/admin/utenti` (Task 8). `App` chiama `GET /api/me` all'avvio: 401 su una pagina protetta → `/accedi`; utente già collegato su `/accedi` → `/`. TokenPage: GET del token → "Link non valido o scaduto" se 404; per l'invito mostra l'email, due campi password (devono coincidere: "Le password non coincidono"), la casella "Ho letto l'informativa" con link a `/informativa` (obbligatoria per l'invio), invio con `privacyVersion: PRIVACY_VERSION`; poi `/`.
  Stile: riprende i colori e i caratteri di `../homeradar/src/ui/sidepanel/styles.css`; layout a colonna singola, leggibile a 360 px.
  `vite.config.ts`: `build.outDir = 'dist'`, proxy di sviluppo `/api` → `http://localhost:8787`.

- [ ] **Step 1: Test che falliscono** (fetch simulato con `vi.stubGlobal`)

```tsx
it('accesso riuscito porta alla home', async () => { /* /api/me 401, poi login 200 → compare "Ciao mario@rossi.it" */ });
it('mostra l\'errore del server', async () => { /* login 401 { error: 'Email o password errati' } → testo visibile */ });
it('attivazione: password diverse', async () => { /* "Le password non coincidono", nessuna POST */ });
it('attivazione: informativa obbligatoria', async () => { /* pulsante disabilitato senza casella */ });
it('attivazione: invia privacyVersion', async () => { /* corpo POST = { password, privacyVersion: PRIVACY_VERSION } */ });
it('link scaduto', async () => { /* GET token 404 → "Link non valido o scaduto" */ });
```

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/web` → FAIL.
- [ ] **Step 3: Implementa** le pagine e il router.
- [ ] **Step 4: Verifica che passino** → PASS; `npm run build -w apps/web` crea `apps/web/dist/index.html`.
- [ ] **Step 5: Commit** — `feat(web): accesso e attivazione dell'account`

---

### Task 8: Portale minimo — admin utenti

**Files:**
- Create: `apps/web/src/pages/AdminUsers.tsx`, `apps/web/src/components/ComunePicker.tsx`
- Test: `apps/web/test/admin-users.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 7), API del Task 6, `searchComuni`, `toRef` da `@homeradar/shared/core/comuni`.
- Produces: `ComunePicker({ value: ComuneRef[]; max: number; onChange(next: ComuneRef[]): void })`: ricerca con suggerimenti (`searchComuni`), etichette con la ✕, campo disattivato al limite con il testo "Al massimo <max> comuni" (come `ZoneEditor` dell'estensione, senza le categorie).
  Pagina `/admin/utenti` (solo admin; un agente viene mandato a `/`): tabella o schede con email, stato (Invitato / Attivo / Sospeso), comuni, ultimo accesso; modulo «Nuovo agente» (email, comuni, limite); dopo la creazione mostra il link d'invito con il pulsante «Copia link» e la nota "Mandalo all'agente: vale 7 giorni e si usa una volta sola". Azioni per riga: modifica comuni e limite, «Sospendi»/«Riattiva», «Nuovo link d'invito» (invitati), «Link per reimpostare la password» (attivi, nota "vale 1 ora"), «Elimina» con conferma in pagina ("Elimina definitivamente <email>?"), non `window.confirm`. Gli errori del server compaiono accanto all'azione.

- [ ] **Step 1: Test che falliscono**

```tsx
it('crea un agente e mostra il link da copiare', async () => { /* POST 201 → testo del link e pulsante «Copia link» (navigator.clipboard.writeText chiamato) */ });
it('mostra l\'errore sui comuni', async () => { /* PATCH 400 { error: 'Al massimo 4 comuni per questo utente' } → testo visibile */ });
it('il picker si ferma al limite', async () => { /* max 1 con un comune scelto → input disabilitato e "Al massimo 1 comuni" */ });
it('elimina solo dopo conferma', async () => { /* clic «Elimina» → nessuna DELETE; clic conferma → DELETE /api/admin/users/<id> */ });
it('un agente non vede la pagina', async () => { /* /api/me role agent → redirect a / */ });
```

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/web` → FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica che passino** → PASS.
- [ ] **Step 5: Commit** — `feat(web): admin utenti`

---

### Task 9: Sviluppo locale, deploy e documentazione

**Files:**
- Create: `docs/deploy.md`, `CLAUDE.md`, `apps/server/.dev.vars.example`
- Modify: `README.md`, `docs/roadmap.md` (tappa 1 → fatto)

**Interfaces:**
- Consumes: tutto quanto sopra.

- [ ] **Step 1: Prova locale end-to-end**

Run: `npm run build -w apps/web`, poi in `apps/server` `npx wrangler d1 migrations apply homeradar-portale --local` e `npx wrangler dev`. Crea l'admin in locale con `node scripts/create-admin.mjs <email>` usando `--local` al posto di `--remote` nel comando stampato. Nel browser: accesso admin → crea agente → apri il link d'invito in una finestra anonima → attiva → home dell'agente con i comuni → sospendi dall'admin → l'agente al ricaricamento vede "Account sospeso".
Expected: ogni passaggio come descritto. Se un passaggio fallisce, correggi e aggiungi il test che mancava.

- [ ] **Step 2: Scrivi `docs/deploy.md`**

Passi: account Cloudflare con piano Workers Paid; `npx wrangler login`; `npx wrangler d1 create homeradar-portale --jurisdiction eu` e `database_id` in `wrangler.toml`; `npx wrangler d1 migrations apply homeradar-portale --remote`; `npm run build -w apps/web`; `npx wrangler deploy` da `apps/server`; creazione dell'admin con `create-admin.mjs`; indirizzo provvisorio `https://homeradar-portale.<account>.workers.dev`.

- [ ] **Step 3: Scrivi `CLAUDE.md`**

Sul modello di quello di `homeradar`: descrizione del progetto, comandi (`npm test`, `npm run typecheck`, `npm run build`, test di un solo workspace, `wrangler dev`), struttura dei workspace, regola sugli import relativi in `packages/shared`, vincoli (Global Constraints di questo piano e §3 della specifica), il fatto che la logica in `packages/shared` è copiata da `homeradar` e da lì in poi evolve qui, e il rimando a `docs/roadmap.md`.

- [ ] **Step 4: Verifica finale**

Run: `npm test` e `npm run typecheck` dalla radice.
Expected: tutto verde.

- [ ] **Step 5: Commit** — `docs: deploy, CLAUDE.md e roadmap`

Il deploy remoto vero (creazione di D1, piano a pagamento, `wrangler deploy`) lo fa Michele seguendo `docs/deploy.md`, oppure lo facciamo insieme quando lo chiede: crea risorse a pagamento sul suo account.
