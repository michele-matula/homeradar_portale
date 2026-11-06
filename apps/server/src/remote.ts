import type { RemotePoll } from '@homeradar/shared/api/connector';
import {
  REMOTE_MIN_VERSION, REMOTE_ONLINE_MS, REMOTE_REQUEST_TTL_MS, remoteState, versionAtLeast, type RemoteOutcome,
} from '@homeradar/shared/core/remote';
import type { SweepStatus } from '@homeradar/shared/shared/types';
import { DEVICE_NAME } from './device';
import { fail, json } from './http';
import { getSettings } from './settings';
import { closeStaleSweeps, planSearches } from './sweeps';
import { toComuneRefs, type UserRow } from './users';

/** Una richiesta più vecchia di così non si mostra più sul telefono. */
const SHOW_MS = 10 * 60_000;
/** Il controllo al minuto scrive l'ultimo contatto al più ogni tanto. */
const POLLED_EVERY_MS = 30_000;
export const NO_REMOTE_COMPUTER = 'Nessun computer con «Avvia dal telefono» attivo: attivalo nelle impostazioni';

interface Enabled { id: string; name: string; version: string | null; polled_at: number | null }

/** Computer dell'utente con «Avvia dal telefono» attivo e connettore abbastanza nuovo. */
async function enabledDevices(db: D1Database, userId: string): Promise<Enabled[]> {
  const { results } = await db.prepare(`SELECT d.id, ${DEVICE_NAME} AS name, d.version, d.polled_at FROM devices d WHERE d.user_id = ? AND d.remote = 1 ORDER BY d.created_at`)
    .bind(userId).all<Enabled>();
  return results.filter((d) => versionAtLeast(d.version, REMOTE_MIN_VERSION));
}

/**
 * «Avvia sul computer» dal telefono. Risponde subito quando nessun computer può servire o i dati sono già freschi;
 * altrimenti lascia la richiesta (una per agente: un secondo tocco non ne crea un'altra).
 */
export async function requestRemote(db: D1Database, user: UserRow, now: number): Promise<Response> {
  await closeStaleSweeps(db, user.id, now);
  if (await db.prepare('SELECT 1 FROM sweeps WHERE user_id = ? AND finished_at IS NULL').bind(user.id).first()) return fail(409, 'Giro già in corso');
  if (!(await enabledDevices(db, user.id)).length) return fail(400, NO_REMOTE_COMPUTER);
  if (!toComuneRefs(user.comuni).length) return fail(400, "Nessun comune assegnato: chiedi all'amministratore");
  const { searches } = await planSearches(db, user, await getSettings(db, user.id), now);
  if (!searches.length) return json({ fresh: true });
  const open = await db.prepare('SELECT 1 FROM remote_requests WHERE user_id = ? AND outcome IS NULL AND device_id IS NULL AND expires_at > ?')
    .bind(user.id, now).first();
  if (open) return json({ fresh: false });
  await db.prepare(`INSERT INTO remote_requests (user_id, id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (user_id) DO UPDATE SET id = ?2, created_at = ?3, expires_at = ?4, device_id = NULL, claimed_at = NULL, outcome = NULL, sweep_id = NULL`)
    .bind(user.id, crypto.randomUUID(), now, now + REMOTE_REQUEST_TTL_MS).run();
  return json({ fresh: false }, 201);
}

/** Annulla la richiesta finché nessun computer l'ha presa. */
export async function cancelRemote(db: D1Database, userId: string): Promise<void> {
  await db.prepare("UPDATE remote_requests SET outcome = 'cancelled' WHERE user_id = ? AND outcome IS NULL AND device_id IS NULL").bind(userId).run();
}

/** «Ferma» dal telefono: il connettore lo legge nella risposta ai lotti o al controllo. */
export async function stopRemote(db: D1Database, userId: string): Promise<void> {
  await db.prepare('UPDATE sweeps SET stop_requested = 1 WHERE user_id = ? AND finished_at IS NULL').bind(userId).run();
}

/** Il computer prende la richiesta: in un solo passaggio, così due computer non la prendono insieme. */
export async function claimRemote(db: D1Database, userId: string, id: string, deviceId: string, now: number): Promise<boolean> {
  const r = await db.prepare(`UPDATE remote_requests SET device_id = ?1, claimed_at = ?2
    WHERE user_id = ?3 AND id = ?4 AND device_id IS NULL AND outcome IS NULL AND expires_at > ?2
      AND EXISTS (SELECT 1 FROM devices WHERE id = ?1 AND user_id = ?3 AND remote = 1)`)
    .bind(deviceId, now, userId, id).run();
  return r.meta.changes === 1;
}

export async function setRemoteOutcome(db: D1Database, userId: string, outcome: RemoteOutcome, sweepId: string | null): Promise<void> {
  await db.prepare('UPDATE remote_requests SET outcome = ?, sweep_id = ? WHERE user_id = ?').bind(outcome, sweepId, userId).run();
}

/** Controllo del connettore: ultimo contatto, interruttore, richiesta da prendere e stop del suo giro. */
export async function pollRemote(db: D1Database, user: UserRow, deviceId: string, now: number): Promise<RemotePoll> {
  const d = await db.prepare('SELECT remote, polled_at FROM devices WHERE id = ?').bind(deviceId).first<{ remote: number; polled_at: number | null }>();
  if (d && (d.polled_at == null || now - d.polled_at > POLLED_EVERY_MS)) {
    await db.prepare('UPDATE devices SET polled_at = ? WHERE id = ?').bind(now, deviceId).run();
  }
  const enabled = d?.remote === 1;
  const request = enabled
    ? await db.prepare('SELECT id FROM remote_requests WHERE user_id = ? AND outcome IS NULL AND device_id IS NULL AND expires_at > ?')
      .bind(user.id, now).first<string>('id')
    : null;
  const stop = await db.prepare('SELECT 1 FROM sweeps WHERE user_id = ? AND device_id = ? AND finished_at IS NULL AND stop_requested = 1')
    .bind(user.id, deviceId).first();
  return { enabled, requestId: request ?? null, stop: stop != null };
}

/** Richiesta recente e computer abilitati, per `GET /api/sweep`. */
export async function remoteStatus(db: D1Database, userId: string, now: number): Promise<Pick<SweepStatus, 'remote' | 'computers'>> {
  const devices = await enabledDevices(db, userId);
  const computers = { enabled: devices.length, online: devices.filter((d) => d.polled_at != null && now - d.polled_at < REMOTE_ONLINE_MS).map((d) => d.name) };
  const r = await db.prepare(`SELECT r.created_at, r.expires_at, r.device_id, r.outcome, ${DEVICE_NAME} AS name
    FROM remote_requests r LEFT JOIN devices d ON d.id = r.device_id WHERE r.user_id = ? AND r.created_at > ?`)
    .bind(userId, now - SHOW_MS)
    .first<{ created_at: number; expires_at: number; device_id: string | null; outcome: RemoteOutcome | null; name: string | null }>();
  const state = r && remoteState({ createdAt: r.created_at, expiresAt: r.expires_at, deviceId: r.device_id, outcome: r.outcome }, now);
  return { remote: r && state ? { state, createdAt: r.created_at, deviceName: r.name } : null, computers };
}
