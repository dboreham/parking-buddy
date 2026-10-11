import { test, expect } from '@playwright/test';

const snapshot = (page) => page.evaluate(() => window.__parkingBuddy.snapshot());

// Wait until a plan has finished and nothing is pending.
async function idle(page) {
  await page.waitForFunction(() => {
    const s = window.__parkingBuddy?.snapshot();
    return s && s.result && !s.busy && !s.stale;
  });
  return snapshot(page);
}

async function skipToEnd(page) {
  await page.click('#btn-end');
  await expect.poll(async () => (await snapshot(page)).playing).toBe(false);
}

async function setLength(page, selector, value) {
  await page.fill(selector, value);
  await page.press(selector, 'Tab');
}

const vehicleRow = (page, name) => page.locator('#results tr', { hasText: name });

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(page.errors, 'no console or page errors').toEqual([]);
});

test('example garage parks all three vehicles', async ({ page }) => {
  const s = await idle(page);
  expect(s.result.parkedCount).toBe(3);
  expect(s.result.freeExit).toBe(3);
  await expect(page.locator('#results .summary')).toContainText('3 of 3 vehicles parked');
  for (const name of ['Medium', 'Large SUV', 'Small car']) {
    await expect(vehicleRow(page, name)).toContainText('drives straight in');
  }
});

test('re-running starts with an empty building and brings cars in one at a time', async ({ page }) => {
  await idle(page);
  await skipToEnd(page);
  expect((await snapshot(page)).drawn).toHaveLength(3);
  await page.locator('#speed').fill('2');
  await page.click('#btn-run');
  await page.waitForFunction(() => {
    const s = window.__parkingBuddy.snapshot();
    return s.playing && s.drawn.length > 0;
  });
  // Only the first car is on the plan while it drives in.
  const s = await snapshot(page);
  expect(s.drawn).toHaveLength(1);
  expect(s.drawn[0].moving).toBe(true);
  await skipToEnd(page);
  expect((await snapshot(page)).drawn).toHaveLength(3);
});

test('auto door offsets follow the building width until overridden', async ({ page }) => {
  await idle(page);
  const offsets = () => page.$$eval('#doors .door-row', (rows) => rows.map((r) => [
    r.querySelector('input.len').value, r.querySelector('input[type=checkbox]').checked,
  ]));
  expect(await offsets()).toEqual([['2.25', true], ['13.5', true], ['24.75', true]]);
  await setLength(page, '#b-width', '40');
  expect(await offsets()).toEqual([['3.25', true], ['15.5', true], ['27.75', true]]);

  await page.locator('#doors .door-row').nth(1).getByTitle('Remove door').click();
  expect(await offsets()).toEqual([['7.33', true], ['23.67', true]]);

  await setLength(page, '#doors .door-row:nth-child(1) input.len', `1'`);
  expect(await offsets()).toEqual([['1', false], ['20.5', true]]);
  const s = await idle(page);
  expect(s.result.parkedCount).toBeGreaterThan(0);
});

test('invalid lengths are flagged and ignored', async ({ page }) => {
  await idle(page);
  await setLength(page, '#b-depth', 'twelve');
  await expect(page.locator('#b-depth')).toHaveClass(/invalid/);
  await setLength(page, '#b-depth', `32'6"`);
  await expect(page.locator('#b-depth')).not.toHaveClass(/invalid/);
  await expect(page.locator('#b-depth')).toHaveValue('32.5');
});

test('a 9 ft door is too narrow for a crew-cab pickup', async ({ page }) => {
  await idle(page);
  await page.selectOption('#preset', 'pickup');
  await page.click('#add-vehicle');
  await page.waitForFunction(() => window.__parkingBuddy.snapshot().result?.vehicles.length === 4);
  await idle(page);
  await expect(vehicleRow(page, 'Full-size pickup')).toContainText('Not parked');
});

async function dragCar(page, name, dx, dy) {
  const s = await idle(page);
  await skipToEnd(page);
  const car = s.result.vehicles.find((v) => v.name === name);
  const [x0, y0] = await page.evaluate(([x, y]) => window.__parkingBuddy.worldToClient(x, y), car.centre);
  const [x1, y1] = await page.evaluate(([x, y]) => window.__parkingBuddy.worldToClient(x, y), [car.centre[0] + dx, car.centre[1] + dy]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  return car;
}

test('dragging a car pins it and the plan honours the pin', async ({ page }) => {
  const before = await dragCar(page, 'Small car', 0, -4);
  const s = await idle(page);
  const after = s.result.vehicles.find((v) => v.id === before.id);
  expect(after.parked).toBe(true);
  expect(Math.abs(after.pose.y - (before.pose.y - 4))).toBeLessThan(1);
  await expect(page.locator('#vehicles .item', { hasText: 'unpin' })).toHaveCount(1);
  await expect(vehicleRow(page, 'Small car')).toContainText('pinned');

  await page.getByRole('button', { name: 'unpin' }).click();
  await expect(page.locator('#vehicles .item', { hasText: 'unpin' })).toHaveCount(0);
});

test('a car dragged out onto the driveway is reported, not parked outside', async ({ page }) => {
  await dragCar(page, 'Small car', 0, -25);
  await idle(page);
  await expect(vehicleRow(page, 'Small car')).toContainText('not inside the building');
});

test('share link reproduces the setup in a fresh browser', async ({ page, browser }) => {
  await idle(page);
  await setLength(page, '#b-width', '42');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#btn-share');
  await expect(page).toHaveURL(/#c=/);
  const url = page.url();

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(url);
  await expect(other.locator('#b-width')).toHaveValue('42');
  await fresh.close();
});

test('explore reports how many layouts it tried', async ({ page }) => {
  await idle(page);
  await page.fill('#trials', '3');
  await page.click('#btn-explore');
  await page.waitForFunction(() => window.__parkingBuddy.snapshot().busy === false && document.querySelector('#results .summary')?.textContent.includes('layouts tried'));
  await expect(page.locator('#results .summary')).toContainText('best of 3 layouts tried');
});

test('phone-width layout has no horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
