import { expect, test } from "@playwright/test";

test("teacher creates merit preset, bulk-awards students, tests 0-floor clamping and negative balance toggle, and student views filtered ledger", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const uniqueCode = `MRT ${Date.now().toString().slice(-4)}`;

  // 1. Teacher logs in and creates an isolated subject
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "MRT-E2E");
  await page.fill("#sub-title", "Phase 3 Merit Ledger Verification");
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

  // 3. Teacher creates a reusable Merit preset (+5)
  await page.getByRole("tab", { name: "Points & Economy" }).click();
  await page.getByRole("button", { name: "New Preset" }).click();
  await page.fill("#preset-name", "Board Solution");
  await page.selectOption("#preset-type", "MERIT");
  await page.fill("#preset-points", "5");
  await page.fill("#preset-description", "Explained solution at the board");
  await page.getByRole("button", { name: "Create Preset" }).click();
  await expect(page.getByText("Board Solution").first()).toBeVisible();

  // 4. Bulk award the preset (+5) to both Student 1 and Student 2
  await page.getByRole("button", { name: "Select All" }).click();
  await page.fill("#merit-note-input", "Week 1 participation");
  await page.getByRole("button", { name: "Apply to 2 Students" }).click();
  await expect(page.getByText("Applied +5 pts to 2 students.")).toBeVisible();

  // 5. Apply custom -8 Demerit to Student 1 with allowNegativeBalance OFF -> floors at 0 pts
  await page.getByRole("button", { name: "Custom +/-" }).click();
  await page.getByRole("button", { name: "Demerit (-)" }).click();
  await page.fill("#custom-points-input", "8");
  await page.fill("#merit-note-input", "Late lab cleanup");
  await page.getByRole("checkbox", { name: /^Student 1 / }).check();
  await page.getByRole("button", { name: "Apply to 1 Student" }).click();

  await expect(
    page.getByText("Applied -8 pts to 1 student (1 floored at 0 pts).")
  ).toBeVisible();
  await expect(
    page.getByText(/Requested -8 pts; floored at 0/).first()
  ).toBeVisible();

  // 6. Enable Allow Negative Point Balance and apply -5 Demerit to Student 1 -> -5 pts
  const negSwitch = page.getByRole("switch", {
    name: "Allow Negative Point Balance",
  });
  const negPatchPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/subjects/") && resp.request().method() === "PATCH"
  );
  await negSwitch.click();
  const negPatchRes = await negPatchPromise;
  expect(negPatchRes.status()).toBe(200);
  await expect(negSwitch).toHaveAttribute("aria-checked", "true");

  await page.fill("#custom-points-input", "5");
  await page.fill("#merit-note-input", "Disruptive phone alert");
  await page.getByRole("checkbox", { name: /^Student 1 / }).check();
  await page.getByRole("button", { name: "Apply to 1 Student" }).click();
  await expect(page.getByText("Applied -5 pts to 1 student.")).toBeVisible();

  // 7. Teacher signs out and Student 1 verifies wallet (-5 pts) and filtered ledger
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
  await expect(page.getByText("-5 pts").first()).toBeVisible();
  await expect(page.getByText("Point Debt")).toBeVisible();
  await expect(page.getByText("Point Transaction Ledger")).toBeVisible();

  // Filter student ledger by Demerits
  await page
    .getByRole("group", { name: "Filter ledger by entry type" })
    .getByRole("button", { name: "Demerits" })
    .click();
  await expect(page.getByText("Disruptive phone alert")).toBeVisible();
  await expect(page.getByText("Board Solution: Week 1 participation")).toBeHidden();
});
