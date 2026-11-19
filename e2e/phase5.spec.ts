import { expect, test } from "@playwright/test";

test("Phase 5: teacher configures computation & scale, creates assessment & enters scores, student redeems Score Boost targeting exam, teacher approves, student views updated standing with zero upload UI", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const uniqueCode = `GRD ${Date.now().toString().slice(-4)}`;

  // 1. Teacher creates subject, enrolls Student 1, awards 30 pts, and creates Score Boost reward
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "P5-E2E");
  await page.fill("#sub-title", "Phase 5 Grading & Boost Verification");
  await page.locator("form button[type='submit']").click();

  const subjectCard = page
    .getByRole("link", { name: new RegExp(uniqueCode) })
    .first();
  await expect(subjectCard).toBeVisible();
  await subjectCard.click();
  await expect(page).toHaveURL(/\/subjects\/.+/);
  const subjectUrl = page.url();

  // Student Roster page: enroll Student 1
  await page.getByRole("tab", { name: "Student Roster" }).click();
  await page.fill("#roster-input", "student1@classpulse.local");
  await page.getByRole("button", { name: "Add to Roster" }).click();
  await expect(page.getByText("Added: 1")).toBeVisible();

  // Standing & Gradebook -> Computation & Scale: save default computation + grade scale
  await page.getByRole("tab", { name: "Standing & Gradebook" }).click();
  await page.getByRole("tab", { name: "Computation & Scale" }).click();

  await page.getByRole("button", { name: "Save Computation Rules" }).click();
  await expect(
    page.getByText("Grade computation formula saved.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Save Grade Scale" }).click();
  await expect(page.getByText("Grade scale saved.")).toBeVisible();

  // Points & Economy tab: award 30 pts to Student 1 and create Score Boost reward (10 pts = +1)
  await page.getByRole("tab", { name: "Points & Economy" }).click();
  await page.getByRole("button", { name: "Custom +/-" }).click();
  await page.fill("#custom-points-input", "30");
  await page.fill("#merit-note-input", "Phase 5 boost balance");
  await page.getByRole("checkbox", { name: /^Student 1 / }).check();
  await page.getByRole("button", { name: "Apply to 1 Student" }).click();
  await expect(page.getByText("Applied +30 pts to 1 student.")).toBeVisible();

  await page.getByRole("button", { name: "New Reward" }).click();
  await page.fill("#reward-name", "Exam Score Boost");
  await page.selectOption("#reward-type", "SCORE_BOOST");
  await page.fill("#reward-cost", "10");
  await page.fill("#reward-score-val", "1");
  await page.getByRole("button", { name: "Create Reward" }).click();
  await expect(page.getByText("Exam Score Boost").first()).toBeVisible();

  // Standing & Gradebook tab: create Midterm Exam (max 50), open dedicated grading page, and enter raw score 45 -> 90.00% (1.75)
  await page.getByRole("tab", { name: "Standing & Gradebook" }).click();
  await page.getByRole("button", { name: "New Assessment" }).click();
  await page.fill("#assessment-title", "Midterm Exam");
  await page.fill("#assessment-max-score", "50");
  await page.getByRole("button", { name: "Create Assessment" }).click();

  const gradeMidtermLink = page.getByRole("link", {
    name: "Grade students for Midterm Exam",
  });
  await expect(gradeMidtermLink).toBeVisible();
  await gradeMidtermLink.click();
  await expect(page).toHaveURL(/\/subjects\/.+\/assessments\/.+/);
  await expect(
    page.getByText("Class Score Grid: Midterm Exam (/50)")
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);

  await page.getByLabel("Status for Student 1").selectOption("GRADED");
  await page.getByLabel("Score for Student 1").fill("45");
  await page.getByRole("button", { name: "Save Scores" }).click();
  await expect(page.getByText("Saved 1 student score(s).")).toBeVisible();

  await page.getByRole("link", { name: "Back to Gradebook" }).click();
  await expect(page).toHaveURL(subjectUrl);
  await expect(page.getByText("90.00%").first()).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);

  // Sign out Teacher
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 2. Student 1 checks read-only assessment (zero file uploads) & initial standing, then redeems +3 boost targeting Midterm Exam
  await page.fill("#identifier", "student1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await expect(page.getByText("90.00%").first()).toBeVisible();
  await expect(page.getByText("1.75").first()).toBeVisible();
  await expect(page.locator("input[type='file']")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);

  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await page.fill("#redemption-units", "3");
  await page.locator("#redemption-target-assessment").selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Submit Redemption (30 pts)" })
    .click();
  await expect(
    page.getByText("Escrowed 30 pts. Waiting for teacher approval.")
  ).toBeVisible();

  // Sign out Student 1
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 3. Teacher approves the Score Boost redemption
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await page.getByRole("tab", { name: "Points & Economy" }).click();
  await expect(page.getByText("Target: Midterm Exam")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(
    page.getByText("No pending redemption requests right now.")
  ).toBeVisible();

  // Sign out Teacher
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 4. Student 1 views updated standing: 45 + 3 = 48/50 = 96.00% -> 1.25 (Very Good)
  await page.fill("#identifier", "student1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await expect(page.getByText("96.00%").first()).toBeVisible();
  await expect(page.getByText("1.25").first()).toBeVisible();
  await expect(page.getByText("45 + 3 boost")).toBeVisible();
});
