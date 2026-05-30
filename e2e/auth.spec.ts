import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

// Smoke test 8: Auth — an unauthenticated user is shown the login screen
// instead of the dashboard. The WebUI has no /login route; when /auth/check
// reports the user as unauthenticated, AuthenticatedApp renders an inline
// login card ("Sign In") in place of the protected app.
test("unauthenticated visitor sees the login screen", async ({ page }) => {
  await setupMockBackend(page, { authenticated: false });

  await page.goto("/");

  // Inline login card, not the dashboard.
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(
    page.getByText("Enter your authentication token to access the dashboard.")
  ).toBeVisible();

  // The protected dashboard heading must NOT be present.
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toHaveCount(0);
});
