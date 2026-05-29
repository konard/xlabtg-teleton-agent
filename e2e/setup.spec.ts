import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

// Smoke test 1: Setup wizard completion. Drives the six-step wizard
// (Welcome → Provider → Config → Wallet → Telegram → Connect) with an LLM
// provider + API key and the Telegram QR login flow, all the way to the
// "Your Agent is ready" completion screen. The QR poll authenticates on the
// mock backend, which triggers the auto-save and renders SetupComplete.
test("setup wizard completes end to end", async ({ page }) => {
  await setupMockBackend(page);

  await page.goto("/setup");

  const next = page.getByRole("button", { name: /^Next:/ });

  // ── Step 1: Welcome — accept the risk acknowledgement. ──
  await expect(page.getByRole("heading", { name: "Welcome to Teleton Setup" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await next.click();

  // ── Step 2: Provider — choose Anthropic and enter an API key. ──
  await expect(page.getByRole("heading", { name: "Choose Your LLM Provider" })).toBeVisible();
  await page.locator(".provider-card", { hasText: "Anthropic" }).click();
  // Wait for the model list to load before typing the key: selecting a provider
  // kicks off an async models fetch whose completion writes the default model
  // into the wizard state. If we filled the key first, that later write could
  // race and clobber the key, leaving the "Next" button disabled.
  await expect(page.getByText("Claude Opus 4.8 - Most capable")).toBeVisible();
  await page.getByPlaceholder("sk-ant...").fill("sk-ant-test-key-0123456789");
  await expect(next).toBeEnabled();
  await next.click();

  // ── Step 3: Config — set the admin user id (model is auto-selected). ──
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
  await page.getByPlaceholder("123456789").fill("123456789");
  await next.click();

  // ── Step 4: Wallet — keep the existing wallet (auto-selected). ──
  await expect(page.getByRole("heading", { name: "TON Wallet" })).toBeVisible();
  await next.click();

  // ── Step 5: Telegram — API credentials, QR auth mode (default). ──
  await expect(page.getByRole("heading", { name: "Telegram Credentials" })).toBeVisible();
  // exact match: the API Hash placeholder substring-contains "12345678".
  await page.getByPlaceholder("12345678", { exact: true }).fill("12345678");
  await page.getByPlaceholder("abcdef0123456789abcdef0123456789").fill("abcdef0123456789");
  await next.click();

  // ── Step 6: Connect — start the QR flow; the mock authenticates on poll. ──
  await expect(page.getByRole("heading", { name: "Connect your Agent to Telegram" })).toBeVisible();
  await page.getByRole("button", { name: "Show QR Code" }).click();
  await expect(page.getByText("Waiting for scan...")).toBeVisible();

  // The QR poll (every 5s) authenticates, auto-saves, and shows completion.
  await expect(page.getByRole("heading", { name: "Your Agent is ready" })).toBeVisible({
    timeout: 20_000,
  });
});
