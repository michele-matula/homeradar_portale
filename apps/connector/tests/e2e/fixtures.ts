import path from 'node:path';
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test';
import { CONNECTOR_ID, type PortalMessage } from '@homeradar/shared/api/connector-messages';
import { startFakeServer, type FakeServer } from './fake-server';

export const PORTAL = 'http://localhost:8799';

export const test = base.extend<{ server: FakeServer; context: BrowserContext; extensionId: string; portal: Page }>({
  server: async ({}, use) => {
    const server = await startFakeServer();
    await use(server);
    await server.close();
  },
  context: async ({ server }, use) => {
    void server;
    const ext = path.resolve('.output-e2e/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    // Nessuna richiesta esce verso internet: i portali sono serviti dai test, il portale dal server finto.
    await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/|localhost:8799\/|127\.0\.0\.1:8799\/)/, (route) => route.abort());
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2]!);
  },
  portal: async ({ context, extensionId }, use) => {
    void extensionId;
    const page = await context.newPage();
    await page.goto(`${PORTAL}/`);
    await use(page);
  },
});

declare const chrome: { runtime: { sendMessage(id: string, m: unknown): Promise<unknown> } };

/** Messaggio dalla pagina del portale al connettore, come fa la SPA. */
export function send(page: Page, m: PortalMessage): Promise<any> {
  return page.evaluate(([id, msg]) => chrome.runtime.sendMessage(id, msg), [CONNECTOR_ID, m] as const);
}

export const expect = test.expect;
