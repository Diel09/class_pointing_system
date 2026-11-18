import { expect, test } from "@playwright/test";

test("teacher starts QR+GPS attendance session, overrides student, closes session, and student views points", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 14.5995, longitude: 120.9842 });

  const uniqueCode = `ATT ${Date.now().toString().slice(-4)}`;

  // 1. Teacher signs in and creates an isolated subject for this E2E run
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "ATT-E2E");
  await page.fill("#sub-title", "Phase 2 Attendance Verification");
  await page.locator("form button[type='submit']").click();

  const subjectCard = page
    .getByRole("link", { name: new RegExp(uniqueCode) })
    .first();
  await expect(subjectCard).toBeVisible();
  await subjectCard.click();
  await expect(page).toHaveURL(/\/subjects\/.+/);

  const subjectUrl = page.url();

  // 2. Enroll student1 and student2 into the subject
  await page.getByRole("tab", { name: "Roster & Computation" }).click();
  await page.fill(
    "#roster-input",
    "student1@classpulse.local, student2@classpulse.local"
  );
  await page.getByRole("button", { name: "Add to Roster" }).click();
  await expect(page.getByText("Added: 2")).toBeVisible();

  // 3. Teacher captures GPS and starts attendance session
  await page.getByRole("tab", { name: "Attendance" }).click();
  await page
    .getByRole("button", { name: /Capture GPS & Start Session|Start Attendance Session/ })
    .click();

  await expect(page).toHaveURL(/\/subjects\/.+\/attendance\/.+/);
  await expect(page.getByText("Live Rotating QR")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Live Attendance QR Code" })
  ).toBeVisible();

  // 4. Teacher manually overrides Student 1 to PRESENT (+10 pts)
  await page.getByRole("button", { name: "Override Student 1" }).click();

  await page.selectOption("#override-status", "PRESENT");
  await page.fill("#override-reason", "E2E manual verification");
  const overrideResponsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes("/override") && resp.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Apply Override" }).click();
  const overrideResponse = await overrideResponsePromise;
  expect(overrideResponse.status()).toBe(200);

  await expect(page.getByText("Wallet: 10 pts")).toBeVisible();
  await expect(page.getByText("Present: 1")).toBeVisible();

  // 5. Teacher closes the session (marks Student 2 ABSENT)
  await page.getByRole("button", { name: "Close Session" }).click();
  await page.getByRole("button", { name: "Confirm Close" }).click();

  await expect(page.getByText("Session Closed")).toBeVisible();
  await expect(page.getByText("Absent: 1")).toBeVisible();

  // 6. Teacher signs out and Student 1 verifies wallet & attendance history
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  await page.fill("#identifier", "student1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await expect(page.getByText("10 pts").first()).toBeVisible();
  await page.getByRole("tab", { name: "Attendance" }).click();
  await expect(page.getByText("My Attendance History")).toBeVisible();
  await expect(page.getByText("• Note: E2E manual verification")).toBeVisible();

  // 7. Student opens the QR + GPS check-in screen cleanly
  await page.getByRole("link", { name: "Scan Attendance QR" }).click();
  await expect(page).toHaveURL(/\/subjects\/.+\/check-in$/);
  await expect(page.getByText("Device GPS Status")).toBeVisible();
});
