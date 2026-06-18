import { describe, expect, it } from "vitest";

import { getSteps, validateStep, type WizardData } from "../SetupContext";

function wizardData(overrides: Partial<WizardData> = {}): WizardData {
  return {
    riskAccepted: true,
    agentName: "Nova",
    provider: "local",
    apiKey: "",
    cocoonPort: 11435,
    localUrl: "http://localhost:11434/v1",
    apiId: 12345,
    apiHash: "abcdef0123456789",
    phone: "+15551234567",
    userId: 42,
    mode: "quick",
    telegramMode: "user",
    model: "",
    customModel: "",
    dmPolicy: "admin-only",
    groupPolicy: "admin-only",
    requireMention: true,
    maxIterations: 5,
    botToken: "",
    botUsername: "",
    tonapiKey: "",
    toncenterKey: "",
    tavilyKey: "",
    customizeThresholds: false,
    buyMaxFloor: 95,
    sellMinFloor: 105,
    walletAction: "keep",
    mnemonic: "",
    walletAddress: "",
    mnemonicSaved: false,
    authSessionId: "",
    telegramUser: null,
    authMode: "qr",
    skipConnect: false,
    webuiEnabled: false,
    execMode: "off",
    exposeLan: false,
    ...overrides,
  };
}

describe("setup wizard step flow", () => {
  it("skips user Telegram auth steps in bot mode", () => {
    expect(getSteps("bot").map((step) => step.id)).toEqual([
      "welcome",
      "provider",
      "config",
      "wallet",
    ]);
  });

  it("requires a bot token on the config step in bot mode", () => {
    const botData = wizardData({ telegramMode: "bot" });

    expect(validateStep(2, botData)).toBe(false);
    expect(validateStep(2, { ...botData, botToken: "123456:ABC" })).toBe(true);
  });

  it("requires the phone number for user-account Telegram config", () => {
    expect(validateStep(4, wizardData({ phone: "" }))).toBe(false);
    expect(validateStep(4, wizardData({ phone: "+15551234567" }))).toBe(true);
  });
});
