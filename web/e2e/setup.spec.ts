import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfilJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockSetupBackend(page: Page): Promise<void> {
  await page.route("**/api/setup/status", (route) =>
    fulfilJson(route, {
      success: true,
      data: {
        workspaceExists: false,
        configExists: false,
        walletExists: false,
        walletAddress: null,
        sessionExists: false,
        envVars: {
          apiKey: null,
          apiKeyRaw: false,
          telegramApiId: null,
          telegramApiHash: null,
          telegramPhone: null,
        },
      },
    }),
  );

  await page.route("**/api/setup/workspace/init", (route) =>
    fulfilJson(route, {
      success: true,
      data: { created: true, path: "/tmp/teleton-test" },
    }),
  );

  await page.route("**/api/setup/providers", (route) =>
    fulfilJson(route, {
      success: true,
      data: [
        {
          id: "local",
          name: "Local OpenAI compatible",
          needsApiKey: false,
          supportsModels: false,
        },
      ],
    }),
  );
}

test.describe("setup wizard", () => {
  test("requires explicit risk acceptance before opening provider step", async ({ page }) => {
    await mockSetupBackend(page);

    await page.goto("/setup");

    const nextButton = page.getByRole("button", {
      name: /Next: Provider|Далее: Провайдер/i,
    });
    await expect(nextButton).toBeDisabled();

    await page
      .getByRole("checkbox", { name: /risks.*responsibility|риски.*ответственность/i })
      .check();

    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(
      page.getByRole("heading", { name: /Choose Your LLM Provider/i }),
    ).toBeVisible();
  });
});
