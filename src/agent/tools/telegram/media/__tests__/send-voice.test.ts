import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateSpeech: vi.fn(),
}));

vi.mock("../../../../../services/tts.js", () => ({
  EDGE_VOICES: {},
  PIPER_VOICES: {},
  generateSpeech: mocks.generateSpeech,
}));

vi.mock("telegram", () => ({
  Api: {
    DocumentAttributeAudio: class {
      _ = "DocumentAttributeAudio";
      voice?: boolean;
      duration?: number;
      waveform?: Buffer;

      constructor(args: { voice?: boolean; duration?: number; waveform?: Buffer }) {
        Object.assign(this, args);
      }
    },
  },
}));

import { telegramSendVoiceExecutor } from "../send-voice.js";

describe("telegramSendVoiceExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateSpeech.mockResolvedValue({
      filePath: "/tmp/teleton-test-voice.ogg",
      provider: "groq",
      voice: "diana",
    });
  });

  it("sends generated speech as an explicit Telegram voice note", async () => {
    const sendFile = vi.fn().mockResolvedValue({ id: 42, date: 123 });
    const result = await telegramSendVoiceExecutor(
      {
        chatId: "chat1",
        text: "hello",
      },
      {
        config: {
          agent: { provider: "anthropic" },
          groq: {
            api_key: "gsk_test",
            tts_model: "canopylabs/orpheus-v1-english",
            tts_voice: "diana",
            tts_format: "wav",
          },
        },
        bridge: {
          getClient: () => ({
            getClient: () => ({ sendFile }),
          }),
        },
      } as any
    );

    expect(result.success).toBe(true);
    expect(sendFile).toHaveBeenCalledWith(
      "chat1",
      expect.objectContaining({
        file: "/tmp/teleton-test-voice.ogg",
        forceDocument: false,
        voiceNote: true,
        attributes: [expect.objectContaining({ _: "DocumentAttributeAudio", voice: true })],
      })
    );
  });
});
