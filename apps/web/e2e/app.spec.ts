import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

/** Collects uncaught page errors so every test also proves "no runtime errors". */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 4\d\d/.test(m.text()) && errors.push(m.text()));
  return errors;
}

async function signIn(page: Page, name: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
}

test('coordinator sees the operations board with every phase', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Sara Khan');
  await expect(page.getByRole('heading', { name: 'Operations board' })).toBeVisible();
  for (const col of ['Documents', 'Customs & DO', 'CCRO gate', 'Delivering', 'Ready to close']) {
    await expect(page.getByRole('heading', { name: col })).toBeVisible();
  }
  await expect(page.getByText('COSU6129887')).toBeVisible();
  expect(errors).toEqual([]);
});

test('owner can open every back-office page without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Omar Haddad');
  const pages: [string, RegExp][] = [
    ['/board', /Operations board/], ['/jobs', /Jobs/], ['/tasks', /My tasks/], ['/containers', /Containers/], ['/customers', /Customers/],
    ['/trips', /Trucks & trips/], ['/finance', /Finance/], ['/reports', /Reports/], ['/settings', /Settings/], ['/notifications', /Notifications/], ['/jobs/new', /New clearance job/],
  ];
  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('CCRO gate is open only when DO and inspection are done; locked steps explain why', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Sara Khan');
  await page.goto('/jobs?q=COSU6129887');
  await page.getByRole('cell', { name: 'COSU6129887' }).click();
  await expect(page.getByRole('button', { name: 'Apply for CCRO' })).toBeEnabled();

  await page.goto('/jobs?q=MAEU238874110');
  await page.getByRole('cell', { name: 'MAEU238874110' }).click();
  await expect(page.getByRole('button', { name: 'Apply for CCRO' })).toBeDisabled();
  await expect(page.getByText(/Delivery order \(DO\) must be: DO received/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('documents gate: verification needs the BL, upload it and verify', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Sara Khan');
  await page.goto('/jobs?q=MEDUJ4471023');
  await page.getByRole('cell', { name: 'MEDUJ4471023' }).click();
  await page.getByRole('button', { name: 'Verify documents' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Verify documents' }).click();
  await expect(page.getByRole('alert')).toContainText('Upload a bill of lading first');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('tab', { name: /Documents/ }).click();
  const pdf = path.join(os.tmpdir(), 'bl-test.pdf');
  writeFileSync(pdf, '%PDF-1.4\n%test\n%%EOF');
  await page.locator('input[type=file]').setInputFiles(pdf);
  await expect(page.getByRole('button', { name: /bl-test\.pdf/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Workflow' }).click();
  await page.getByRole('button', { name: 'Verify documents' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Verify documents' }).click();
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'File Bayan' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('PRO field app queues an update offline and syncs it when back online @mobile', async ({ page, context }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Yusuf Ali');
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  const action = page.getByRole('button', { name: 'Approved / duty assessed' }).first();
  await expect(action).toBeEnabled();
  await context.setOffline(true);
  await action.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approved / duty assessed' }).click();
  await expect(page.getByText('Saved offline — will sync')).toBeVisible();
  await expect(page.getByText('Waiting for connection')).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Waiting for connection')).toHaveCount(0, { timeout: 15_000 });
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
});

test('customer portal shows only the customer’s own shipments', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'Ahmed Al Mansouri');
  await expect(page.getByRole('heading', { name: 'My shipments' })).toBeVisible();
  await expect(page.getByText('MEDUJ4471023')).toBeVisible();
  await expect(page.getByText('MAEU238874110')).toHaveCount(0); // Desert Bloom's BL
  await page.getByText('HLCUDXB250901').click();
  await expect(page.getByText('Clearance progress')).toBeVisible();
  expect(errors).toEqual([]);
});

test('driver trip link works without an account', async ({ page, request }) => {
  const errors = watchErrors(page);
  const login = await request.post('/api/auth/dev-login', { data: { email: 'sara@gulfgate.demo' } });
  const { accessToken } = await login.json();
  const trips = await (await request.get('/api/v1/field/trips', { headers: { authorization: `Bearer ${accessToken}` } })).json();
  const active = trips.items.find((t: { status: string }) => t.status !== 'COMPLETED');
  const link = await (await request.post(`/api/v1/field/trips/${active.id}/link`, { headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': `e2e-${Date.now()}` } })).json();
  await page.context().clearCookies();
  await page.goto(new URL(link.url).pathname);
  await expect(page.getByText(active.tripNo)).toBeVisible();
  await expect(page.getByText('Proof of delivery')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Arabic switches the whole app to right-to-left', async ({ page }) => {
  await signIn(page, 'Sara Khan');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'لوحة العمليات' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
