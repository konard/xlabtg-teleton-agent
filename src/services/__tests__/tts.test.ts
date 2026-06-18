import { existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groqSpeak: vi.fn(),
  wavToOggOpus: vi.fn(),
}));

vi.mock("../../providers/groq/GroqTTSProvider.js", () => ({
  groqSpeak: mocks.groqSpeak,
}));

vi.mock("../../utils/audio.js", () => ({
  wavToOggOpus: mocks.wavToOggOpus,
}));

import { generateSpeech } from "../tts.js";
import { ensurePrivateTempDir } from "../../utils/private-temp.js";

const TTS_TEMP_DIR = ensurePrivateTempDir("tts");

describe("generateSpeech Groq TTS", () => {
  let filesBeforeTest: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    filesBeforeTest = new Set(existsSync(TTS_TEMP_DIR) ? readdirSync(TTS_TEMP_DIR) : []);
    mocks.groqSpeak.mockResolvedValue(Buffer.from("wav-bytes"));
    mocks.wavToOggOpus.mockReturnValue(Buffer.from("ogg-bytes"));
  });

  afterEach(() => {
    if (!existsSync(TTS_TEMP_DIR)) return;

    for (const filename of readdirSync(TTS_TEMP_DIR)) {
      if (filesBeforeTest.has(filename)) continue;

      try {
        unlinkSync(join(TTS_TEMP_DIR, filename));
      } catch {
        // Ignore cleanup errors from files already removed by the implementation.
      }
    }
  });

  it("requests Groq WAV and converts it to OGG/Opus in-process for Telegram voice messages", async () => {
    const result = await generateSpeech({
      text: "hello",
      provider: "groq",
      voice: "diana",
      groqApiKey: "gsk_test",
      groqModel: "canopylabs/orpheus-v1-english",
      groqFormat: "mp3",
    });

    expect(mocks.groqSpeak).toHaveBeenCalledWith("hello", {
      apiKey: "gsk_test",
      model: "canopylabs/orpheus-v1-english",
      voice: "diana",
      responseFormat: "wav",
    });
    expect(result.filePath).toMatch(/\.ogg$/);
    expect(result.provider).toBe("groq");
    expect(result.voice).toBe("diana");
    expect(mocks.wavToOggOpus).toHaveBeenCalledWith(expect.any(Buffer));
    // Confirms we did NOT shell out to ffmpeg — the conversion is fully in-process.
  });

  it("fails with a clear message when in-process conversion throws", async () => {
    mocks.wavToOggOpus.mockImplementationOnce(() => {
      throw new Error("opus encoder boom");
    });

    await expect(
      generateSpeech({
        text: "hello",
        provider: "groq",
        voice: "diana",
        groqApiKey: "gsk_test",
        groqFormat: "wav",
      })
    ).rejects.toThrow(/conversion to OGG\/Opus.*opus encoder boom/i);
  });
});
