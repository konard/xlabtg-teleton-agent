#!/usr/bin/env node
/**
 * Reproducer for issue #465 / PR #466.
 *
 * Demonstrates that `src/utils/audio.ts#wavToOggOpus` performs the WAV → OGG/Opus
 * conversion that Telegram voice notes require, fully in-process, with no system
 * `ffmpeg` install. Run with:
 *
 *   npx tsx experiments/wav-to-ogg-opus.mjs
 *
 * The script synthesizes a short sine wave WAV (PCM s16le), runs the real
 * implementation on it, and writes the resulting OGG/Opus next to it. If you
 * have `ffprobe` installed you can verify the output with:
 *
 *   ffprobe -v error -show_streams /tmp/teleton-issue-465-<id>/voice.ogg
 *
 * (ffprobe is only used to *verify* — the conversion itself does not need it.)
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use tsx so we can import the TypeScript source directly.
const { wavToOggOpus } = await import("../src/utils/audio.ts");

function makeSineWav({ sampleRate = 24000, durationSec = 1, freq = 440 } = {}) {
  const numSamples = sampleRate * durationSec;
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 32767 * 0.5);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

const wav = makeSineWav({ sampleRate: 24000, durationSec: 1, freq: 440 });
const ogg = wavToOggOpus(wav);

const outDir = mkdtempSync(join(tmpdir(), "teleton-issue-465-"));
const outPath = join(outDir, "voice.ogg");
writeFileSync(outPath, ogg);

console.log(`WAV input:  ${wav.length} bytes (24 kHz mono, 1 s, 440 Hz sine)`);
console.log(`OGG output: ${ogg.length} bytes -> ${outPath}`);
console.log(`First 4 bytes of output: ${ogg.subarray(0, 4).toString("ascii")}`); // should be "OggS"
