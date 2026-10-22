export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Commit del deploy (`npm run deploy`): versione degli errori del server. */
  VERSION?: string;
}
