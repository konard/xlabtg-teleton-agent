// src/backup/archive.ts
//
// Minimal, dependency-free POSIX `ustar` tar writer/reader combined with gzip
// (via node:zlib). Producing a *real* tar.gz means the archives created by
// `teleton backup` can also be inspected/extracted with the system `tar`
// utility (and vice-versa), while keeping the tooling fully cross-platform and
// free of native/3rd-party archiving dependencies.

import { gzipSync, gunzipSync } from "zlib";

const BLOCK_SIZE = 512;
// `name` field of the ustar header is 100 bytes. We keep archive entry names
// short (relative paths inside the backup) so the `prefix` field is never
// required.
const MAX_NAME_LENGTH = 100;

export interface ArchiveEntry {
  /** Relative path stored inside the archive (POSIX separators). */
  name: string;
  /** Raw file contents. */
  data: Buffer;
  /** Unix mode bits (defaults to 0o644). */
  mode?: number;
  /** Modification time in seconds since the epoch (defaults to 0). */
  mtime?: number;
}

function writeString(block: Buffer, value: string, offset: number, length: number): void {
  block.write(value, offset, length, "ascii");
}

/** Write a NUL-terminated octal number into a fixed-width header field. */
function writeOctal(block: Buffer, value: number, offset: number, length: number): void {
  // length-1 octal digits, zero-padded, followed by a trailing NUL.
  const octal = value.toString(8).padStart(length - 1, "0");
  block.write(octal, offset, length - 1, "ascii");
  block[offset + length - 1] = 0;
}

function buildHeader(entry: ArchiveEntry): Buffer {
  if (Buffer.byteLength(entry.name, "utf-8") > MAX_NAME_LENGTH) {
    throw new Error(`Archive entry name too long (max ${MAX_NAME_LENGTH} bytes): ${entry.name}`);
  }

  const header = Buffer.alloc(BLOCK_SIZE, 0);
  writeString(header, entry.name, 0, 100);
  writeOctal(header, entry.mode ?? 0o644, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, entry.data.length, 124, 12);
  writeOctal(header, Math.floor(entry.mtime ?? 0), 136, 12);
  header[156] = "0".charCodeAt(0); // typeflag: normal file
  writeString(header, "ustar", 257, 6); // magic (NUL-terminated)
  header[263] = "0".charCodeAt(0); // version
  header[264] = "0".charCodeAt(0);

  // Checksum is computed with the checksum field filled with spaces.
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += header[i];
  // 6 octal digits, NUL, space.
  writeString(header, checksum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function padToBlock(size: number): number {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? 0 : BLOCK_SIZE - remainder;
}

/** Build an uncompressed tar buffer from the given entries. */
export function createTar(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(buildHeader(entry));
    chunks.push(entry.data);
    const padding = padToBlock(entry.data.length);
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }
  // Two zero-filled blocks mark the end of the archive.
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2, 0));
  return Buffer.concat(chunks);
}

/** Parse an uncompressed tar buffer back into entries. */
export function parseTar(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);

    // End-of-archive marker: a fully zeroed block.
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("ascii").replace(/\0.*$/, "");
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const modeField = header.subarray(100, 108).toString("ascii").replace(/\0.*$/, "").trim();
    const mode = parseInt(modeField, 8) || 0o644;

    offset += BLOCK_SIZE;
    const data = Buffer.from(buffer.subarray(offset, offset + size));
    offset += size + padToBlock(size);

    entries.push({ name, data, mode });
  }

  return entries;
}

/** Create a gzip-compressed tar archive (`.tar.gz`). */
export function createTarGz(entries: ArchiveEntry[]): Buffer {
  return gzipSync(createTar(entries));
}

/** Parse a gzip-compressed tar archive (`.tar.gz`). */
export function parseTarGz(buffer: Buffer): ArchiveEntry[] {
  return parseTar(gunzipSync(buffer));
}
