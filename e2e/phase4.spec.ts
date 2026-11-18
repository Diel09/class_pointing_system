import { expect, test } from "@playwright/test";

test("GCash-style P2P QR transfer, redemption escrow, student cancel refund, and teacher approval", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const uniqueCode = `ECN ${Date.now().toString().slice(-4)}`;

  // 1. Teacher creates subject, enrolls Student 1 & Student 2, awards 50 pts to Student 1, and adds Score Boost reward
  await page.goto("/login");
  await page.fill("#identifier", "teacher1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Create Subject" }).click();
  await page.fill("#sub-code", uniqueCode);
  await page.fill("#sub-section", "P4-E2E");
  await page.fill("#sub-title", "Phase 4 Economy Verification");
  await page.locator("form button[type='submit']").click();

  const subjectCard = page
    .getByRole("link", { name: new RegExp(uniqueCode) })
    .first();
  await expect(subjectCard).toBeVisible();
  await subjectCard.click();
  await expect(page).toHaveURL(/\/subjects\/.+/);

  const subjectUrl = page.url();

  // Enroll Student 1 & Student 2
  await page.getByRole("tab", { name: "Roster & Computation" }).click();
  await page.fill(
    "#roster-input",
    "student1@classpulse.local, student2@classpulse.local"
  );
  await page.getByRole("button", { name: "Add to Roster" }).click();
  await expect(page.getByText("Added: 2")).toBeVisible();

  // Award 50 pts to Student 1
  await page.getByRole("tab", { name: "Points & Economy" }).click();
  await page.getByRole("button", { name: "Custom +/-" }).click();
  await page.fill("#custom-points-input", "50");
  await page.fill("#merit-note-input", "Initial Phase 4 economy balance");
  await page.getByRole("checkbox", { name: /^Student 1 / }).check();
  await page.getByRole("button", { name: "Apply to 1 Student" }).click();
  await expect(page.getByText("Applied +50 pts to 1 student.")).toBeVisible();

  // Configure P2P max per transfer = 20 and create a Score Boost reward (10 pts = +1)
  await page.fill("#p2p-max-transfer", "20");
  await page.getByRole("button", { name: "Save Guardrails" }).click();
  await expect(page.getByText("Point economy guardrails saved.")).toBeVisible();

  await page.getByRole("button", { name: "New Reward" }).click();
  await page.fill("#reward-name", "Midterm Score Boost");
  await page.selectOption("#reward-type", "SCORE_BOOST");
  await page.fill("#reward-cost", "10");
  await page.fill("#reward-score-val", "1");
  await page.getByRole("button", { name: "Create Reward" }).click();
  await expect(page.getByText("Midterm Score Boost").first()).toBeVisible();

  // Sign out Teacher
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 2. Student 2 generates a Receive Points QR code requesting 15 pts
  await page.fill("#identifier", "student2@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await page.getByRole("button", { name: "Receive Points" }).click();
  await page.fill("#p2p-req-amount", "15");
  await page.fill("#p2p-req-note", "Lab partner lunch");
  await page.getByRole("button", { name: "Update QR Details" }).click();
  await expect(page.getByText("Requesting: 15 pts")).toBeVisible();

  const qrPayload = (
    await page.getByTestId("p2p-qr-payload").innerText()
  ).trim();
  expect(qrPayload.startsWith("p2p:")).toBe(true);
  await page.getByRole("button", { name: "Close Receive QR" }).click();

  // Sign out Student 2
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 3. Student 1 sends 15 pts via P2P QR, then submits & cancels a redemption, and submits one for approval
  await page.fill("#identifier", "student1@classpulse.local");
  await page.fill("#password", "Password123!");
  await page.locator("form button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(subjectUrl);
  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await page.getByRole("link", { name: "Send Points" }).click();
  await expect(page).toHaveURL(/\/subjects\/.+\/p2p\/send$/);

  await page.fill("#p2p-manual-payload", qrPayload);
  await page.getByRole("button", { name: "Verify Classmate QR" }).click();
  await expect(page.getByText("Verified Recipient")).toBeVisible();
  await expect(page.getByText("Student 2")).toBeVisible();
  await page.getByRole("button", { name: "Confirm & Send Points" }).click();

  await expect(page.getByText("Transfer Successful")).toBeVisible();
  await expect(page.getByText("35 pts").first()).toBeVisible();
  await page.getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(subjectUrl);

  // Submit 20 pts Score Boost redemption for Midterm Exam (35 -> 15 available, 20 escrowed)
  await page.getByRole("tab", { name: "Points & Rewards" }).click();
  await page.fill("#redemption-units", "2");
  await page.fill("#redemption-target-label", "Midterm Exam");
  await page
    .getByRole("button", { name: "Submit Redemption (20 pts)" })
    .click();
  await expect(
    page.getByText("Escrowed 20 pts. Waiting for teacher approval.")
  ).toBeVisible();
  await expect(page.getByText("15 pts").first()).toBeVisible();

  // Submit a second 10 pt redemption and cancel it immediately (15 -> 5 -> 15 available)
  await page.fill("#redemption-units", "1");
  await page.fill("#redemption-target-label", "Quiz 2");
  await page
    .getByRole("button", { name: "Submit Redemption (10 pts)" })
    .click();
  await expect(
    page.getByText("Escrowed 10 pts. Waiting for teacher approval.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(
    page.getByText("Redemption cancelled and points refunded to Available.")
  ).toBeVisible();

  // Sign out Student 1
  await page
    .locator(
      "button:has-text('Sign Out'):visible, button[aria-label='Sign Out']:visible"
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/login/);

  // 4. Teacher approves Student 1's Midterm Exam boost request
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

  // Sign out Teacher and verify Student 1 sees Approved + 15 pts available / 0 escrowed
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
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expect(page.getByText("15 pts").first()).toBeVisible();
  await expect(page.getByText("0 pts").first()).toBeVisible();
});
