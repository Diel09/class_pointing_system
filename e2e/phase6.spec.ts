import { expect, test } from "@playwright/test";

test("Phase 6: notifications center, admin searchable audit log viewer, PWA manifest, and offline guardrails", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const uniqueCode = `P6 ${Date.now().toString().slice(-4)}`;

  // 1. Verify PWA manifest serves valid standalone configuration and icons
  const manifestRes = await page.request.get("/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);
  const manifestJson = (await manifestRes.json()) as {
    display: string;
    short_name: string;
    icons: { sizes: string }[];
  };
  expect(manifestJson.display).toBe("standalone");
  expect(manifestJson.short_name).toBe("Puento");
  expect(manifestJson.icons.some((i) => i.sizes === "192x192")).toBe(true);
  expect(manifestJson.icons.some((i) => i.sizes === "512x512")).toBe(true);

  // 2. Teacher creates a subject, enrolls Student 3, and awards a +5 merit (triggers notification)
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "P6-E2E");
  await page.fill("#sub-title", "Phase 6 PWA & Notifications");
  await page.locator("form button[type='submit']").click();

  const subjectCard = page
    .getByRole("link", { name: new RegExp(uniqueCode) })
    .first();
  await expect(subjectCard).toBeVisible();
  await subjectCard.click();
  await expect(page).toHaveURL(/\/subjects\/.+/);
  const subjectUrl = page.url();

  await page.getByRole("tab", { name: "Roster & Computation" }).click();
  await page.fill("#roster-input", "student3@classpulse.local");
  await page.getByRole("button", { name: "Add to Roster" }).click();
  await expect(page.getByText("Added: 1")).toBeVisible();

  await page.getByRole("tab", { name: "Points & Economy" }).click();
  await page.getByRole("button", { name: "Custom +/-" }).click();
  await page.fill("#custom-points-input", "5");
  await page.fill("#merit-note-input", "Phase 6 notification check");
  await page.getByRole("checkbox", { name: /^Student 3 / }).check();
  await page.getByRole("button", { name: "Apply to 1 Student" }).click();
  await expect(page.getByText("Applied +5 pts to 1 student.")).toBeVisible();

  // Sign out Teacher
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 3. Student 3 checks Notification Bell badge, marks notifications read, and verifies offline guardrails
  await page.fill("#identifier", "student3@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const badge = page.getByTestId("notification-unread-badge");
  await expect(badge).toBeVisible();

  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(
    page.getByText(`Merit Received (${uniqueCode})`).first()
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(badge).toBeHidden();
  await page.getByRole("button", { name: "Close notifications" }).click();

  // Verify offline guardrail banner on Check-In screen
  await page.goto(`${subjectUrl}/check-in`);
  await expect(page.getByText("Device GPS Status")).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("You are offline")).toBeVisible();
  await expect(
    page.getByText("Internet connection required for QR & GPS attendance check-in.")
  ).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("You are offline")).toBeHidden();

  // Sign out Student 3
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 4. Admin logs in and verifies Audit Logs searchable viewer
  await page.fill("#identifier", "admin@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/admin");
  await expect(page.getByText("Admin Oversight Console")).toBeVisible();
  await page.getByRole("button", { name: "Audit Logs" }).click();
  await expect(page.getByText("System Audit Logs")).toBeVisible();

  await page.fill("#audit-search-input", uniqueCode);
  await page.getByRole("button", { name: "Search Logs" }).click();
  await expect(
    page.locator("span", { hasText: "MERIT_AWARDED" }).first()
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).first().click();
  await expect(page.getByText("After State")).toBeVisible();
});
