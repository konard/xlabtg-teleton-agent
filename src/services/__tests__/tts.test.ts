import { EventEmitter } from "events";
import { existsSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groqSpeak: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("../../providers/groq/GroqTTSProvider.js", () => ({
  groqSpeak: mocks.groqSpeak,
}));

import { generateSpeech } from "../tts.js";

const TTS_TEMP_DIR = join(tmpdir(), "teleton-tts");

function mockFfmpegClose(code: number, stderr = ""): void {
  mocks.spawn.mockImplementationOnce((_command, args: string[]) => {
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    };
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };

    setImmediate(() => {
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      if (code === 0) {
        const outputPath = args.at(-1);
        if (outputPath) writeFileSync(outputPath, Buffer.from("ogg-bytes"));
      }
      proc.emit("close", code);
    });

    return proc;
  });
}

describe("generateSpeech Groq TTS", () => {
  let filesBeforeTest: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    filesBeforeTest = new Set(existsSync(TTS_TEMP_DIR) ? readdirSync(TTS_TEMP_DIR) : []);
    mocks.groqSpeak.mockResolvedValue(Buffer.from("wav-bytes"));
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

  it("requests Groq WAV and converts it to OGG/Opus for Telegram voice messages", async () => {
    mockFfmpegClose(0);

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
    expect(mocks.spawn).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-i",
        expect.stringMatching(/\.wav$/),
        "-c:a",
        "libopus",
        "-application",
        "voip",
        expect.stringMatching(/\.ogg$/),
      ])
    );
  });

  it("fails instead of returning a WAV attachment when Telegram conversion fails", async () => {
    mockFfmpegClose(1, "ffmpeg missing");

    await expect(
      generateSpeech({
        text: "hello",
        provider: "groq",
        voice: "diana",
        groqApiKey: "gsk_test",
        groqFormat: "wav",
      })
    ).rejects.toThrow(/Telegram voice/i);
  });
});
