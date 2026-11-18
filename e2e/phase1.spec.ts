import { expect, test } from "@playwright/test";

test("teacher creates subject with invite QR and student joins with 0 pts wallet", async ({
  page,
}) => {
  const uniqueCode = `E2E ${Date.now().toString().slice(-4)}`;

  // 1. Teacher signs in
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Teacher Workspace")).toBeVisible();

  // 2. Teacher creates a new subject
  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "SEC-E2E");
  await page.fill("#sub-title", "Phase 1 E2E Verification");
  await page.locator("form button[type='submit']").click();

  // Open the newly created subject card
  const subjectCard = page.getByRole("link", { name: new RegExp(uniqueCode) }).first();
  await expect(subjectCard).toBeVisible();
  await subjectCard.click();

  await expect(page).toHaveURL(/\/subjects\/.+/);
  await page.getByRole("tab", { name: "Roster & Computation" }).click();
  await expect(page.getByText("Class Invite Code & QR")).toBeVisible();

  // Capture generated invite code
  const inviteCodeEl = page.locator("p.font-mono.font-bold.tracking-widest");
  await expect(inviteCodeEl).toBeVisible();
  const inviteCode = (await inviteCodeEl.innerText()).trim();
  expect(inviteCode).toMatch(/^[A-Z2-9]{8}$/);

  // 3. Teacher signs out
  await page
    .locator("button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible")
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 4. Student signs in and joins via invite code
  await page.fill("#identifier", "student8@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/join");
  await page.fill("#inviteCode", inviteCode);
  await page.locator("form button[type='submit']").click();

  await expect(page).toHaveURL(/\/subjects\/.+/);
  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await expect(page.getByText("Available Balance")).toBeVisible();
  await expect(page.getByText("0 pts").first()).toBeVisible();

  // 5. Student is blocked from /admin
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
});
