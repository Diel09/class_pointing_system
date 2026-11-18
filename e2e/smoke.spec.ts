import { expect, test } from "@playwright/test";

test("renders standard login homepage on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Welcome to Puento")).toBeVisible();
  await expect(page.locator("#identifier")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByText(/QR.*Attendance/)).toBeVisible();
  await expect(page.getByText("Class Standing (1.00–5.00)")).toBeVisible();
});
