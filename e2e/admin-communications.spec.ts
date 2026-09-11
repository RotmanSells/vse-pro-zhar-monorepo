import { expect, test } from "@playwright/test";

import { loginAdmin, loginAdminApi } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Communications persists drafts while keeping dispatch unavailable and responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/communications`)).status()).toBe(401);
  await loginAdminApi(request);
  const idempotencyKey = `e2e-communication-${Date.now()}`;
  const draftPayload = { idempotencyKey, templateCode: "promo", body: "🔥 {name}, E2E draft", channel: "push", delaySeconds: 60, segmentCode: "regulars", promoDefinitionId: null };
  const created = await request.post(`${E2E_API_URL}/admin/communications/drafts`, { data: draftPayload });
  expect(created.status()).toBe(201);
  const createdBody = await created.json() as { draft: { id: number; version: number } };
  const repeated = await request.post(`${E2E_API_URL}/admin/communications/drafts`, { data: draftPayload });
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).draft.id).toBe(createdBody.draft.id);
  const updated = await request.patch(`${E2E_API_URL}/admin/communications/drafts/${createdBody.draft.id}`, { data: { templateCode: "promo", body: "🔥 {name}, E2E updated draft", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: null, expectedVersion: 1 } });
  expect(updated.status()).toBe(200);
  const stale = await request.patch(`${E2E_API_URL}/admin/communications/drafts/${createdBody.draft.id}`, { data: { templateCode: "promo", body: "🔥 {name}, stale update", channel: "push", delaySeconds: 0, segmentCode: "regulars", promoDefinitionId: null, expectedVersion: 1 } });
  expect(stale.status()).toBe(409);
  const archived = await request.post(`${E2E_API_URL}/admin/communications/drafts/${createdBody.draft.id}/archive`, { data: { expectedVersion: 2 } });
  expect(archived.status()).toBe(200);
  expect((await archived.json()).draft.status).toBe("archived");
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Рассылки", exact: true }).click();
  await expect(page.getByRole("heading", { name: "История рассылок", exact: true })).toBeVisible();
  await expect(page.getByText("Черновики и история")).toBeVisible();
  await expect(page.getByRole("button", { name: "⇩ Экспорт" })).toBeDisabled();
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`communications-history-${width}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("button", { name: "Сегменты", exact: true }).click();
  await page.getByRole("button", { name: "Открыть сегмент «Постоянные»" }).click();
  await expect(page.getByRole("button", { name: "✈ Написать сегменту" })).toBeEnabled();
  await page.getByRole("button", { name: "✈ Написать сегменту" }).click();
  const composerDialog = page.getByRole("dialog", { name: "📨 Написать сегменту" });
  await expect(composerDialog).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect(page.getByText("Промо-акция")).toBeVisible();
  await expect(page.getByRole("button", { name: "✈ Отправить" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "✈ Отправить" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Отправка недоступна до подключения Push/SMS")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Доставлено");

  const browserDraftBody = `🔥 {name}, browser draft ${Date.now()}`;
  await page.getByLabel("Текст сообщения").fill(browserDraftBody);
  await expect(page.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled();
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page.getByText("Черновик сохранён в Backend.")).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  const createdRow = page.locator(".communications-table tbody tr").filter({ hasText: browserDraftBody });
  await expect(createdRow).toHaveCount(1);
  await createdRow.getByRole("button", { name: /Открыть черновик/u }).click();
  const editedBrowserDraftBody = `${browserDraftBody} updated`;
  await page.getByLabel("Текст сообщения").fill(editedBrowserDraftBody);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByText("Черновик сохранён в Backend.")).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  const editedRow = page.locator(".communications-table tbody tr").filter({ hasText: editedBrowserDraftBody });
  await expect(editedRow).toHaveCount(1);
  await editedRow.getByRole("button", { name: /Архивировать черновик/u }).click();
  await expect(page.locator(".communications-table tbody tr").filter({ hasText: editedBrowserDraftBody }).getByText("Архив")).toBeVisible();

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`communications-${width}.png`), fullPage: false });
    const touchViolations = await page.locator("button,[role='button'],select,textarea,input:not([type='checkbox'])").evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }] : [];
    }));
    expect(touchViolations).toEqual([]);
  }
  await page.close();
});
