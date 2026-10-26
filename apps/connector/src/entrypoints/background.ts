import '../zod-config';
import type { SweepPlan } from '@homeradar/shared/api/connector';
import { NOT_LINKED } from '@homeradar/shared/api/connector-messages';
import { PORTAL_SITES, type Portal } from '@homeradar/shared/shared/types';
import { createAutoSweep } from '../auto';
import { createClient, errorOf, type ServerReply } from '../client';
import { deviceName } from '../device-name';
import { createErrorLog, type StoredError } from '../errors';
import { handleExternal } from '../external';
import { createSendQueue } from '../queue';
import { openQueueStore } from '../queue-store';
import type { ReaderMessage } from '../reader';
import { createRunner, type RunnerState } from '../runner';
import { stuckSignal } from '../stuck';
import { TIMING } from '../timing';

const PORTAL = new URL(import.meta.env.WXT_PORTAL_URL).origin;
const UNREACHABLE = 'Server non raggiungibile: controlla la connessione';
const HELLO_EVERY_MS = 3_600_000;
const STUCK_TEXT = 'HomeRadar non riesce a inviare i dati: controlla la connessione';

const failure = (r: ServerReply) => new Error(errorOf(r) ?? (r.status === 0 ? UNREACHABLE : `Errore ${r.status}`));

export default defineBackground(() => {
  const version = browser.runtime.getManifest().version;
  const token = async () => ((await browser.storage.local.get('token')).token as string | undefined) ?? null;
  const unlink = () => browser.storage.local.remove(['token', 'userId']);
  const stuck = stuckSignal({
    load: async () => (await browser.storage.local.get('stuck')).stuck === true,
    save: (v) => browser.storage.local.set({ stuck: v }),
    show(v) {
      void browser.action.setBadgeText({ text: v ? '!' : '' });
      if (v) void browser.action.setBadgeBackgroundColor({ color: '#c62828' });
    },
    notify() {
      void browser.notifications.create('stuck', {
        type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: 'HomeRadar', message: STUCK_TEXT,
      });
    },
  });
  const client = createClient({ baseUrl: PORTAL, token, fetch: (input, init) => fetch(input, init) });

  const errorLog = createErrorLog({
    load: async () => ((await browser.storage.local.get('errors')).errors as StoredError[] | undefined) ?? [],
    save: (list) => browser.storage.local.set({ errors: list }),
    post: (path, body) => client.post(path, body),
    now: Date.now,
    version,
  });
  // Si prova a mandarlo subito; se la rete manca resta nel buffer per il prossimo contatto.
  const reportError = (message: string, context?: string) => void errorLog.report(message, context).then(() => errorLog.flush()).catch(() => {});
  const flushErrors = () => void errorLog.flush().catch(() => {});
  self.addEventListener('error', (e) => reportError(e.message || 'Errore del background'));
  self.addEventListener('unhandledrejection', (e) => reportError(e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason)));

  /** Nome del dispositivo: browser e sistema. */
  async function currentName(): Promise<string> {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
    return deviceName(brands, (await browser.runtime.getPlatformInfo()).os);
  }
  /**
   * Si fa sentire dal server (ultimo contatto, nome e versione), poi manda gli errori rimasti. Il worker si riaccende
   * spesso: senza `force` al più una volta l'ora.
   */
  async function hello(force: boolean): Promise<void> {
    if (!(await token())) return;
    const last = ((await browser.storage.local.get('helloAt')).helloAt as number | undefined) ?? 0;
    if (!force && Date.now() - last < HELLO_EVERY_MS) return;
    const r = await client.post('/connector/hello', { name: await currentName(), version });
    if (r.status === 401) return unlink();
    if (r.status >= 200 && r.status < 300) await browser.storage.local.set({ helloAt: Date.now() });
    flushErrors();
  }

  const queue = createSendQueue({
    store: openQueueStore(),
    post: (path, body) => client.post(path, body),
    now: Date.now,
    timing: TIMING,
    // Il timer basta se il worker resta acceso; l'allarme lo riaccende se nel frattempo si è spento.
    schedule(at) {
      setTimeout(() => void queue.flush().catch(() => {}), Math.max(0, at - Date.now()));
      void browser.alarms.create('queue', { when: at });
    },
    onStuck: (v) => void stuck(v).catch(() => {}),
    onRejected: (path, status, error) => reportError(`Invio scartato: ${status} ${error ?? ''}`.trim(), path),
    // Scollegato dal portale: niente più invii possibili, il giro in corso si ferma.
    async onUnlinked() {
      await unlink();
      void runner.stop().catch(() => {});
    },
  });

  const runner = createRunner({
    now: Date.now,
    random: Math.random,
    uuid: () => crypto.randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    // Una chiamata alle API ogni 20 s tiene acceso il service worker durante il giro.
    keepAlive: () => {
      const h = setInterval(() => void browser.runtime.getPlatformInfo(), 20_000);
      return () => clearInterval(h);
    },
    // Finestra vuota, poi la prima pagina: anche la prima è una navigazione della scheda come le altre.
    async openWindow(url) {
      const w = await browser.windows.create({ url: 'about:blank', state: 'minimized', focused: false, type: 'normal' });
      const ids = { windowId: w!.id!, tabId: w!.tabs![0]!.id! };
      await browser.tabs.update(ids.tabId, { url });
      return ids;
    },
    navigate: async (tabId, url) => {
      await browser.tabs.update(tabId, { url });
    },
    closeWindow: async (windowId) => {
      await browser.windows.remove(windowId);
    },
    loadState: async () => ((await browser.storage.local.get('sweep')).sweep as RunnerState | undefined) ?? null,
    saveState: async (s) => {
      if (s) await browser.storage.local.set({ sweep: s });
      else await browser.storage.local.remove('sweep');
    },
    timing: TIMING,
    async plan(auto) {
      const r = await client.post('/connector/sweeps', auto ? { auto: true } : {});
      if (r.status === 401) {
        await unlink();
        throw new Error(NOT_LINKED);
      }
      if (r.status !== 200 && r.status !== 201) throw failure(r);
      return r.data as SweepPlan;
    },
    enqueue: (o) => queue.enqueue(o),
    reportError,
    // Giro automatico finito: via la notifica d'avvio; se un portale ha chiesto una verifica, l'agente deve saperlo.
    onEnd({ auto, blocked }) {
      if (!auto) return;
      void browser.notifications.clear('auto');
      if (!blocked.length) return;
      void browser.storage.local.set({ verify: blocked });
      const sites = blocked.map((p) => PORTAL_SITES[p]);
      const message = `${sites.join(' e ')} ${sites.length > 1 ? 'hanno' : 'ha'} chiesto una verifica: aprilo tu`;
      void browser.notifications.create('verify', { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: 'HomeRadar', message });
    },
  });

  // Giro automatico: il server dice se è dovuto; qui si decide quando chiederlo.
  const auto = createAutoSweep({
    now: Date.now,
    linked: async () => (await token()) != null,
    idleState: () => browser.idle.queryState(300),
    running: () => runner.running(),
    loadNext: async () => ((await browser.storage.local.get('nextAutoAt')).nextAutoAt as number | undefined) ?? 0,
    saveNext: (at) => browser.storage.local.set({ nextAutoAt: at }),
    start: () => {
      void queue.flush({ force: true }).catch(() => {});
      return runner.start({ auto: true });
    },
  });
  async function checkAuto(): Promise<void> {
    if ((await auto.check()) !== 'started') return;
    void browser.notifications.create('auto', {
      type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: 'HomeRadar',
      message: 'HomeRadar sta cercando i nuovi annunci in una finestra ridotta a icona', buttons: [{ title: 'Ferma' }],
    });
  }

  async function link(code: string): Promise<void> {
    const name = await currentName();
    // Il token che il browser aveva già: il server sostituisce quel dispositivo invece di lasciarlo come connettore muto.
    const previousToken = await token();
    let res: Response;
    try {
      res = await fetch(`${PORTAL}/connector/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, version, ...(previousToken ? { previousToken } : {}) }),
      });
    } catch {
      throw new Error(UNREACHABLE);
    }
    const data: unknown = await res.json().catch(() => null);
    if (res.status !== 201) throw failure({ status: res.status, data });
    const { token: t, userId } = data as { token: string; userId: string };
    await browser.storage.local.set({ token: t, userId });
    flushErrors();
    void auto.reset();
  }

  browser.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
    void handleExternal(msg, origin, {
      portalOrigin: PORTAL,
      version,
      linkedUser: async () => {
        const s = await browser.storage.local.get(['token', 'userId']);
        return s.token ? ((s.userId as string | undefined) ?? null) : null;
      },
      link,
      start: () => {
        // Prima di un giro nuovo si riprova quello che è rimasto indietro, anche oltre le 24 ore.
        void queue.flush({ force: true }).catch(() => {});
        return runner.start();
      },
      stop: () => runner.stop(),
      sweeping: () => runner.running(),
      queueState: () => queue.state(),
      retryNow: () => void queue.flush({ force: true }).catch(() => {}),
      autoChanged: () => void auto.reset().then(checkAuto).catch(() => {}),
    }).then(sendResponse);
    return true;
  });

  // Content script dei portali: leggono solo se la loro scheda è quella del giro.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const m = msg as ReaderMessage | undefined;
    if (m?.type === 'isSweepTab') {
      runner.isSweepTab(sender.tab?.id).then(sendResponse, () => sendResponse(false));
      return true;
    }
    if (m?.type === 'page') {
      runner.page(sender.tab?.id, m).then(() => sendResponse(null), () => sendResponse(null));
      return true;
    }
    if (m?.type === 'error') {
      reportError(m.message, sender.url ? new URL(sender.url).hostname : undefined);
      return false;
    }
    return false;
  });

  // L'agente chiude la finestra del giro: giro interrotto, le pagine lette partono comunque.
  browser.windows.onRemoved.addListener((windowId) => void runner.windowRemoved(windowId).catch(() => {}));
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'queue') void queue.flush().catch(() => {});
    if (alarm.name === 'hello') void hello(true).catch(() => {});
    if (alarm.name === 'auto' || alarm.name === 'auto-start') void checkAuto().catch(() => {});
  });
  // Contatto quotidiano, anche senza giri: l'admin vede che il connettore c'è e con che versione.
  void browser.alarms.create('hello', { periodInMinutes: 24 * 60 });
  // Giro automatico: un controllo ogni tanto (Chrome aperto per giorni, PC risvegliato) e al ritorno dell'agente al computer.
  // Il worker si riaccende spesso: ricreare l'allarme lo sposterebbe in avanti a ogni risveglio, e non scatterebbe mai.
  void browser.alarms.get('auto').then((a) => {
    if (!a) return browser.alarms.create('auto', { periodInMinutes: TIMING.autoEveryMin });
  }).catch(() => {});
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'active') void checkAuto().catch(() => {});
  });
  browser.notifications.onButtonClicked.addListener((id) => {
    if (id === 'auto') void runner.stop().catch(() => {});
  });
  browser.notifications.onClicked.addListener((id) => {
    if (id !== 'verify') return;
    void (async () => {
      const [first] = ((await browser.storage.local.get('verify')).verify as Portal[] | undefined) ?? [];
      if (first) await browser.tabs.create({ url: `https://www.${PORTAL_SITES[first].toLowerCase()}/` });
      await browser.notifications.clear('verify');
    })().catch(() => {});
  });
  void hello(false).catch(() => {});
  // Worker riavviato o browser chiuso a giro in corso (lo stato è in storage.local): il giro si chiude come interrotto.
  // storage.session sopravvive al worker ma non al browser: se manca il segno, il browser è ripartito e gli ID delle
  // finestre sono di altre finestre, da non chiudere.
  void (async () => {
    const sameBrowser = (await browser.storage.session.get('alive')).alive === true;
    await browser.storage.session.set({ alive: true });
    await runner.recover({ closeWindow: sameBrowser });
  })().catch(() => {});
  void queue.flush().catch(() => {});
  void queue.state().then((q) => stuck(q.stuck)).catch(() => {});
  // All'avvio del browser il worker parte da sé: si riprova anche quello che era fermo da oltre 24 ore.
  browser.runtime.onStartup.addListener(() => {
    void queue.flush({ force: true }).catch(() => {});
    void hello(true).catch(() => {});
    // Il primo controllo del giro automatico aspetta che il browser abbia ripreso le schede: un allarme, il worker si spegne.
    void browser.alarms.create('auto-start', { when: Date.now() + TIMING.autoStartDelayMs });
  });
});
