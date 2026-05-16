import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateSpeech: vi.fn(),
  wavToOggOpus: vi.fn(),
  validateReadPath: vi.fn(),
}));

vi.mock("../../../../../services/tts.js", () => ({
  EDGE_VOICES: {},
  PIPER_VOICES: {},
  generateSpeech: mocks.generateSpeech,
}));

vi.mock("../../../../../utils/audio.js", () => ({
  wavToOggOpus: mocks.wavToOggOpus,
}));

vi.mock("../../../../../workspace/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateReadPath: mocks.validateReadPath,
  };
});

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

const TTS_TEMP_DIR = join(tmpdir(), "teleton-tts");

/** Build a minimal valid PCM WAV buffer with the RIFF/WAVE header. */
function buildWavBuffer(payload: Buffer = Buffer.from([0, 0, 0, 0])): Buffer {
  const dataSize = payload.length;
  const fmtChunkSize = 16;
  const riffSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);
  const buf = Buffer.alloc(8 + riffSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(riffSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(fmtChunkSize, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(48000, 24); // sample rate
  buf.writeUInt32LE(96000, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  payload.copy(buf, 44);
  return buf;
}

describe("telegramSendVoiceExecutor", () => {
  let scratchDir: string;
  let filesBeforeTest: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    scratchDir = mkdtempSync(join(tmpdir(), "send-voice-test-"));
    filesBeforeTest = new Set(existsSync(TTS_TEMP_DIR) ? readdirSync(TTS_TEMP_DIR) : []);
    mocks.generateSpeech.mockResolvedValue({
      filePath: "/tmp/teleton-test-voice.ogg",
      provider: "groq",
      voice: "diana",
    });
    mocks.wavToOggOpus.mockReturnValue(Buffer.from("ogg-bytes"));
    mocks.validateReadPath.mockImplementation((p: string) => ({
      absolutePath: p,
      relativePath: p,
      exists: true,
      isDirectory: false,
      extension: p.endsWith(".wav") ? ".wav" : ".ogg",
      filename: p.split("/").pop() ?? p,
    }));
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    if (!existsSync(TTS_TEMP_DIR)) return;

    for (const filename of readdirSync(TTS_TEMP_DIR)) {
      if (filesBeforeTest.has(filename)) continue;

      try {
        rmSync(join(TTS_TEMP_DIR, filename), { force: true });
      } catch {
        // Ignore cleanup errors from files already removed by the implementation.
      }
    }
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

  it("auto-converts a WAV file passed via voicePath into OGG/Opus before sending", async () => {
    const wavPath = join(scratchDir, "groq-output.wav");
    writeFileSync(wavPath, buildWavBuffer());

    const sendFile = vi.fn().mockResolvedValue({ id: 7, date: 1 });
    const result = await telegramSendVoiceExecutor(
      {
        chatId: "chat2",
        voicePath: wavPath,
      },
      {
        config: { agent: { provider: "anthropic" } },
        bridge: {
          getClient: () => ({
            getClient: () => ({ sendFile }),
          }),
        },
      } as any
    );

    expect(result.success).toBe(true);
    expect(mocks.wavToOggOpus).toHaveBeenCalledTimes(1);
    expect(mocks.wavToOggOpus).toHaveBeenCalledWith(expect.any(Buffer));

    const sendFileArgs = sendFile.mock.calls[0];
    expect(sendFileArgs[0]).toBe("chat2");
    const sendOpts = sendFileArgs[1];
    expect(sendOpts.voiceNote).toBe(true);
    expect(sendOpts.file).toMatch(/\.ogg$/);
    expect(sendOpts.file).not.toBe(wavPath);
    // The transcoded temp file should be cleaned up after sending.
    expect(existsSync(sendOpts.file)).toBe(false);
  });

  it("leaves an existing OGG voicePath untouched (no double conversion)", async () => {
    const oggPath = join(scratchDir, "voice.ogg");
    writeFileSync(oggPath, Buffer.from("OggS\0\0\0\0...")); // OGG magic, not WAV

    const sendFile = vi.fn().mockResolvedValue({ id: 8, date: 2 });
    const result = await telegramSendVoiceExecutor(
      {
        chatId: "chat3",
        voicePath: oggPath,
      },
      {
        config: { agent: { provider: "anthropic" } },
        bridge: {
          getClient: () => ({
            getClient: () => ({ sendFile }),
          }),
        },
      } as any
    );

    expect(result.success).toBe(true);
    expect(mocks.wavToOggOpus).not.toHaveBeenCalled();
    expect(sendFile).toHaveBeenCalledWith(
      "chat3",
      expect.objectContaining({ file: oggPath, voiceNote: true })
    );
  });

  it("surfaces a clear error when WAV transcoding fails", async () => {
    const wavPath = join(scratchDir, "bad.wav");
    writeFileSync(wavPath, buildWavBuffer());
    mocks.wavToOggOpus.mockImplementationOnce(() => {
      throw new Error("opus encoder boom");
    });

    const sendFile = vi.fn();
    const result = await telegramSendVoiceExecutor(
      {
        chatId: "chat4",
        voicePath: wavPath,
      },
      {
        config: { agent: { provider: "anthropic" } },
        bridge: {
          getClient: () => ({
            getClient: () => ({ sendFile }),
          }),
        },
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /Failed to convert WAV voice file to OGG\/Opus.*opus encoder boom/i
    );
    expect(sendFile).not.toHaveBeenCalled();
  });
});
