import type { AdminUser, Me, UserStatus } from '@homeradar/shared/api/types';
import type { ComuneRef } from '@homeradar/shared/shared/types';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { ComunePicker } from '../components/ComunePicker';
import { Layout } from '../components/Layout';

const STATUS_LABELS: Record<UserStatus, string> = { invited: 'Invitato', active: 'Attivo', suspended: 'Sospeso' };
const DEFAULT_MAX = 4;

const formatDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('it-IT') : 'mai');

/** Link monouso da girare all'agente, con il pulsante per copiarlo. */
function LinkBox({ url, note }: { url: string; note: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <div className="notice linkbox">
      <code className="linkbox__url">{url}</code>
      <div className="linkbox__actions">
        <button type="button" className="btn btn--small" onClick={copy}>
          Copia link
        </button>
        {copied && <span>Copiato</span>}
      </div>
      <p className="hint">{note}</p>
    </div>
  );
}

function NewAgent({ onCreated }: { onCreated(u: AdminUser): void }) {
  const [email, setEmail] = useState('');
  const [comuni, setComuni] = useState<ComuneRef[]>([]);
  const [maxComuni, setMaxComuni] = useState(DEFAULT_MAX);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: AdminUser; inviteUrl: string }>('POST', '/api/admin/users', { email, comuni: comuni.map((c) => c.istat), maxComuni });
      onCreated(r.user);
      setLink(r.inviteUrl);
      setEmail('');
      setComuni([]);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  };

  return (
    <form className="card form form--wide" aria-label="Nuovo agente" onSubmit={submit}>
      <h2>Nuovo agente</h2>
      <label htmlFor="new-email">Email dell'agente</label>
      <input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="new-max">Limite comuni</label>
      <input id="new-max" type="number" min={1} max={30} value={maxComuni} onChange={(e) => setMaxComuni(Number(e.target.value))} />
      <span className="form__label">Comuni</span>
      <ComunePicker value={comuni} max={maxComuni} onChange={setComuni} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary" disabled={busy}>
        Crea e invita
      </button>
      {link && <LinkBox url={link} note="Mandalo all'agente: vale 7 giorni e si usa una volta sola" />}
    </form>
  );
}

function UserRow({ user, onChange, onDeleted }: { user: AdminUser; onChange(u: AdminUser): void; onDeleted(): void }) {
  const [editing, setEditing] = useState(false);
  const [comuni, setComuni] = useState(user.comuni);
  const [maxComuni, setMaxComuni] = useState(user.maxComuni);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [link, setLink] = useState<{ url: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  };
  const patch = (body: object) =>
    run(async () => {
      onChange((await api<{ user: AdminUser }>('PATCH', `/api/admin/users/${user.id}`, body)).user);
      setEditing(false);
    });
  const invite = () =>
    run(async () => {
      const r = await api<{ inviteUrl: string }>('POST', `/api/admin/users/${user.id}/invite`);
      setLink({ url: r.inviteUrl, note: "Mandalo all'agente: vale 7 giorni e si usa una volta sola" });
    });
  const reset = () =>
    run(async () => {
      const r = await api<{ resetUrl: string }>('POST', `/api/admin/users/${user.id}/reset`);
      setLink({ url: r.resetUrl, note: 'Vale 1 ora e si usa una volta sola' });
    });
  const remove = () =>
    run(async () => {
      await api('DELETE', `/api/admin/users/${user.id}`);
      onDeleted();
    });

  const isAdmin = user.role === 'admin';
  return (
    <li className="card user">
      <div className="user__head">
        <strong className="user__email">{user.email}</strong>
        <span className={`status status--${user.status}`}>{isAdmin ? 'Amministratore' : STATUS_LABELS[user.status]}</span>
      </div>
      {!isAdmin && (
        <p className="user__meta">
          {user.comuni.length ? user.comuni.map((c) => c.name).join(', ') : 'Nessun comune'} · limite {user.maxComuni} · ultimo accesso {formatDate(user.lastSeenAt)}
        </p>
      )}
      {editing && (
        <div className="user__edit">
          <label htmlFor={`max-${user.id}`}>Limite comuni</label>
          <input id={`max-${user.id}`} type="number" min={1} max={30} value={maxComuni} onChange={(e) => setMaxComuni(Number(e.target.value))} />
          <ComunePicker value={comuni} max={maxComuni} onChange={setComuni} />
          <div className="actions">
            <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => patch({ comuni: comuni.map((c) => c.istat), maxComuni })}>
              Salva
            </button>
            <button type="button" className="btn btn--small" onClick={() => setEditing(false)}>
              Annulla
            </button>
          </div>
        </div>
      )}
      {!isAdmin && !editing && (
        <div className="actions">
          <button type="button" className="btn btn--small" onClick={() => setEditing(true)}>
            Modifica
          </button>
          {user.status === 'active' && (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => patch({ status: 'suspended' })}>
              Sospendi
            </button>
          )}
          {user.status === 'suspended' && (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => patch({ status: 'active' })}>
              Riattiva
            </button>
          )}
          {user.status === 'invited' && (
            <button type="button" className="btn btn--small" disabled={busy} onClick={invite}>
              Nuovo link d'invito
            </button>
          )}
          {user.status === 'active' && (
            <button type="button" className="btn btn--small" disabled={busy} onClick={reset}>
              Link per reimpostare la password
            </button>
          )}
          <button type="button" className="btn btn--small btn--danger" onClick={() => setConfirmDelete(true)}>
            Elimina
          </button>
        </div>
      )}
      {confirmDelete && (
        <div className="confirm">
          <p>Elimina definitivamente {user.email}?</p>
          <div className="actions">
            <button type="button" className="btn btn--small btn--danger" disabled={busy} onClick={remove}>
              Conferma eliminazione
            </button>
            <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(false)}>
              Annulla
            </button>
          </div>
        </div>
      )}
      {link && <LinkBox url={link.url} note={link.note} />}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

export function AdminUsers({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: AdminUser[] }>('GET', '/api/admin/users')
      .then((r) => setUsers(r.users))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const replace = (u: AdminUser) => setUsers((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null);
  const add = (u: AdminUser) => setUsers((list) => [...(list ?? []), u].sort((a, b) => a.email.localeCompare(b.email)));
  const drop = (id: string) => setUsers((list) => list?.filter((x) => x.id !== id) ?? null);

  return (
    <Layout me={me} onSignOut={onSignOut}>
      <h1>Utenti</h1>
      <NewAgent onCreated={add} />
      {error && <p className="error" role="alert">{error}</p>}
      {!users && !error && <p aria-busy="true">Caricamento…</p>}
      {users && (
        <ul className="users">
          {users.map((u) => (
            <UserRow key={u.id} user={u} onChange={replace} onDeleted={() => drop(u.id)} />
          ))}
        </ul>
      )}
    </Layout>
  );
}
