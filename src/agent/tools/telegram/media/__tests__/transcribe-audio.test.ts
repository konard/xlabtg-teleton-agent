import { describe, it, expect, vi, beforeEach } from "vitest";
import { telegramTranscribeAudioExecutor } from "../transcribe-audio.js";
import type { ToolContext } from "../../../types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../../../providers/groq/GroqSTTProvider.js", () => ({
  groqTranscribe: vi.fn(),
}));

import { groqTranscribe } from "../../../../../providers/groq/GroqSTTProvider.js";

const mockGroqTranscribe = vi.mocked(groqTranscribe);

const mockInvoke = vi.fn();
const mockGetEntity = vi.fn();
const mockGetMessages = vi.fn();
const mockDownloadMedia = vi.fn();

function makeContext(groqApiKey?: string): ToolContext {
  return {
    bridge: {
      getClient: () => ({
        getClient: () => ({
          invoke: mockInvoke,
          getEntity: mockGetEntity,
          getMessages: mockGetMessages,
          downloadMedia: mockDownloadMedia,
        }),
      }),
    },
    chatId: "chat1",
    senderId: 123,
    isGroup: false,
    config: groqApiKey
      ? ({
          agent: { provider: "anthropic", api_key: "" },
          groq: {
            api_key: groqApiKey,
            stt_model: "whisper-large-v3-turbo",
            tts_model: "canopylabs/orpheus-v1-english",
            tts_voice: "autumn",
            tts_format: "mp3",
            tts_mode: "voice_calls_only",
            rate_limit_mode: "auto",
          },
        } as any)
      : undefined,
  } as unknown as ToolContext;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("telegramTranscribeAudioExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Groq STT path (groq.api_key configured)", () => {
    it("uses Groq STT when api_key is configured and audio is available", async () => {
      const audioBuffer = Buffer.from("fake-audio-data");
      mockGetMessages.mockResolvedValue([{ media: null }]);
      mockDownloadMedia.mockResolvedValue(audioBuffer);
      mockGroqTranscribe.mockResolvedValue({
        text: "Hello world",
        language: "en",
        duration: 2.5,
      });

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 42 },
        makeContext("gsk_test_key")
      );

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe("Hello world");
      expect((result.data as any).provider).toBe("groq");
      expect((result.data as any).language).toBe("en");
      expect((result.data as any).pending).toBe(false);
      expect(mockGroqTranscribe).toHaveBeenCalledWith(
        audioBuffer,
        expect.stringMatching(/voice\.ogg|audio\.mp3/),
        expect.objectContaining({ apiKey: "gsk_test_key" })
      );
      // Should NOT call Telegram native transcription
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("uses agent api_key when provider is groq and no explicit groq.api_key", async () => {
      const audioBuffer = Buffer.from("fake-audio");
      mockGetMessages.mockResolvedValue([{ media: null }]);
      mockDownloadMedia.mockResolvedValue(audioBuffer);
      mockGroqTranscribe.mockResolvedValue({ text: "Test transcription" });

      const context: ToolContext = {
        bridge: {
          getClient: () => ({
            getClient: () => ({
              invoke: mockInvoke,
              getEntity: mockGetEntity,
              getMessages: mockGetMessages,
              downloadMedia: mockDownloadMedia,
            }),
          }),
        },
        chatId: "chat1",
        senderId: 123,
        isGroup: false,
        config: {
          agent: { provider: "groq", api_key: "gsk_agent_key" },
          groq: {
            stt_model: "whisper-large-v3-turbo",
            tts_model: "canopylabs/orpheus-v1-english",
            tts_voice: "autumn",
            tts_format: "mp3",
            tts_mode: "voice_calls_only",
            rate_limit_mode: "auto",
          },
        } as any,
      } as unknown as ToolContext;

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 99 },
        context
      );

      expect(result.success).toBe(true);
      expect(mockGroqTranscribe).toHaveBeenCalledWith(
        audioBuffer,
        expect.any(String),
        expect.objectContaining({ apiKey: "gsk_agent_key" })
      );
    });

    it("falls back to Telegram native if Groq STT throws", async () => {
      mockGetMessages.mockResolvedValue([{ media: null }]);
      mockDownloadMedia.mockResolvedValue(Buffer.from("audio"));
      mockGroqTranscribe.mockRejectedValue(new Error("Groq STT network error"));

      // Telegram native succeeds
      mockGetEntity.mockResolvedValue({});
      mockInvoke.mockResolvedValue({ pending: false, text: "Native result", transcriptionId: 1n });

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 42 },
        makeContext("gsk_test_key")
      );

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe("Native result");
      expect(mockInvoke).toHaveBeenCalled();
    });

    it("falls back to Telegram native if no audio buffer returned", async () => {
      mockGetMessages.mockResolvedValue([{ media: null }]);
      mockDownloadMedia.mockResolvedValue(null);

      mockGetEntity.mockResolvedValue({});
      mockInvoke.mockResolvedValue({
        pending: false,
        text: "Native transcription",
        transcriptionId: 2n,
      });

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 42 },
        makeContext("gsk_test_key")
      );

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe("Native transcription");
    });
  });

  describe("Telegram native path (no groq.api_key)", () => {
    it("uses Telegram native transcription when no Groq key", async () => {
      mockGetEntity.mockResolvedValue({});
      mockInvoke.mockResolvedValue({
        pending: false,
        text: "Telegram transcribed text",
        transcriptionId: 5n,
      });

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 77 },
        makeContext() // no groq key
      );

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe("Telegram transcribed text");
      expect(mockGroqTranscribe).not.toHaveBeenCalled();
    });

    it("returns helpful error message when Premium required without Groq", async () => {
      mockGetEntity.mockResolvedValue({});
      const premiumError = new Error("Telegram Premium required");
      (premiumError as any).errorMessage = "PREMIUM_ACCOUNT_REQUIRED";
      mockInvoke.mockRejectedValue(premiumError);

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 55 },
        makeContext() // no groq key
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Telegram Premium");
      expect(result.error).toContain("groq.api_key");
    });

    it("returns error for invalid message ID", async () => {
      mockGetEntity.mockResolvedValue({});
      const invalidMsgError = new Error("Invalid message");
      (invalidMsgError as any).errorMessage = "MSG_ID_INVALID";
      mockInvoke.mockRejectedValue(invalidMsgError);

      const result = await telegramTranscribeAudioExecutor(
        { chatId: "chat1", messageId: 0 },
        makeContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid message ID");
    });
  });

  describe("tool definition", () => {
    it("tool description mentions Groq Whisper STT", async () => {
      const { telegramTranscribeAudioTool } = await import("../transcribe-audio.js");
      expect(telegramTranscribeAudioTool.description).toContain("Groq");
      expect(telegramTranscribeAudioTool.description).toContain("groq.api_key");
    });
  });
});
