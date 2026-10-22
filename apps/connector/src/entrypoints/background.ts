import type { SweepPlan } from '@homeradar/shared/api/connector';
import { NOT_LINKED } from '@homeradar/shared/api/connector-messages';
import { createClient, errorOf, type ServerReply } from '../client';
import { deviceName } from '../device-name';
import { handleExternal } from '../external';
import { createSendQueue } from '../queue';
import { openQueueStore } from '../queue-store';
import type { ReaderMessage } from '../reader';
import { createRunner, type RunnerState } from '../runner';
import { stuckSignal } from '../stuck';
import { TIMING } from '../timing';

const PORTAL = new URL(import.meta.env.WXT_PORTAL_URL).origin;
const UNREACHABLE = 'Server non raggiungibile: controlla la connessione';
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
    async plan() {
      const r = await client.post('/connector/sweeps', {});
      if (r.status === 401) {
        await unlink();
        throw new Error(NOT_LINKED);
      }
      if (r.status !== 200 && r.status !== 201) throw failure(r);
      return r.data as SweepPlan;
    },
    enqueue: (o) => queue.enqueue(o),
  });

  async function link(code: string): Promise<void> {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
    const name = deviceName(brands, (await browser.runtime.getPlatformInfo()).os);
    let res: Response;
    try {
      res = await fetch(`${PORTAL}/connector/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name, version }),
      });
    } catch {
      throw new Error(UNREACHABLE);
    }
    const data: unknown = await res.json().catch(() => null);
    if (res.status !== 201) throw failure({ status: res.status, data });
    const { token: t, userId } = data as { token: string; userId: string };
    await browser.storage.local.set({ token: t, userId });
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
    return false;
  });

  // L'agente chiude la finestra del giro: giro interrotto, le pagine lette partono comunque.
  browser.windows.onRemoved.addListener((windowId) => void runner.windowRemoved(windowId).catch(() => {}));
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'queue') void queue.flush().catch(() => {});
  });
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
  browser.runtime.onStartup.addListener(() => void queue.flush({ force: true }).catch(() => {}));
});
