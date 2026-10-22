import { expect, test, type Page } from '@playwright/test';

// Utenti e annunci seminati da scripts/e2e.mjs.
const ADMIN = { email: 'admin@homeradar.test', password: 'password-e2e-admin' };
const AGENT = { email: 'agente@homeradar.test', password: 'password-e2e-agente' };
const TITLES = ['Trilocale in centro', 'Villa con giardino', 'Bilocale luminoso'];

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

async function expectLeads(page: Page) {
  for (const t of TITLES) await expect(page.getByRole('link', { name: `Apri il lead: ${t}` })).toBeVisible();
}

test('invito → accesso → lead', async ({ page, browser }) => {
  // L'admin crea l'agente con un comune e prende il link d'invito.
  await page.goto('/');
  await signIn(page, ADMIN);
  await expect(page.getByRole('button', { name: 'Esci' })).toBeVisible();
  await page.goto('/admin/utenti');
  const form = page.getByRole('form', { name: 'Nuovo agente' });
  await form.getByLabel("Email dell'agente").fill(AGENT.email);
  await form.getByLabel('Cerca un comune').fill('Treviglio');
  await form.getByRole('button', { name: /^Treviglio/ }).click();
  await form.getByRole('button', { name: 'Crea e invita' }).click();
  const link = (await form.locator('.linkbox__url').textContent())!.trim();
  expect(link).toContain('/attiva/');

  // L'agente, su un browser suo, attiva l'account e vede i lead della zona.
  const agent = await (await browser.newContext()).newPage();
  await agent.goto(link);
  await agent.getByLabel('Nuova password').fill(AGENT.password);
  await agent.getByLabel('Ripeti la password').fill(AGENT.password);
  await agent.getByLabel(/Ho letto l'informativa/).check();
  await agent.getByRole('button', { name: "Attiva l'account" }).click();
  await expectLeads(agent);

  // Lo stato di un lead si salva sul server.
  await agent.getByRole('link', { name: 'Apri il lead: Trilocale in centro' }).click();
  const detail = agent.getByRole('region', { name: 'Scheda del lead' });
  await detail.getByRole('combobox', { name: 'Stato' }).selectOption({ label: 'Contattato' });
  await expect(agent.getByRole('tab', { name: /^Contattati \(1\)/ })).toBeVisible();
  await agent.reload();
  await expect(agent.getByRole('region', { name: 'Scheda del lead' }).getByRole('combobox', { name: 'Stato' })).toHaveValue('contacted');

  // Esce e rientra con la sua password.
  await agent.getByRole('button', { name: 'Esci' }).click();
  await signIn(agent, AGENT);
  await expect(agent.getByRole('link', { name: 'Apri il lead: Villa con giardino' })).toBeVisible();
});
