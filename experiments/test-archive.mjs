// Quick test of archive.ts logic after compilation
import { gzipSync, gunzipSync } from "zlib";

const BLOCK_SIZE = 512;
const MAX_NAME_LENGTH = 100;
const GNU_LONGLINK = "././@LongLink";

function writeString(block, value, offset, length) {
  block.write(value, offset, length, "ascii");
}

function writeOctal(block, value, offset, length) {
  const octal = value.toString(8).padStart(length - 1, "0");
  block.write(octal, offset, length - 1, "ascii");
  block[offset + length - 1] = 0;
}

function buildHeader(name, dataLength, typeflag, mode, mtime) {
  const header = Buffer.alloc(BLOCK_SIZE, 0);
  writeString(header, name.slice(0, MAX_NAME_LENGTH), 0, MAX_NAME_LENGTH);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, dataLength, 124, 12);
  writeOctal(header, Math.floor(mtime), 136, 12);
  header[156] = typeflag.charCodeAt(0);
  writeString(header, "ustar", 257, 6);
  header[263] = "0".charCodeAt(0);
  header[264] = "0".charCodeAt(0);

  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += header[i];
  writeString(header, checksum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function padToBlock(size) {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? 0 : BLOCK_SIZE - remainder;
}

function pushEntry(chunks, entry) {
  const nameBytes = Buffer.byteLength(entry.name, "utf-8");

  if (nameBytes > MAX_NAME_LENGTH) {
    const longData = Buffer.from(entry.name + "\0", "utf-8");
    chunks.push(buildHeader(GNU_LONGLINK, longData.length, "L", 0o644, 0));
    chunks.push(longData);
    const longPad = padToBlock(longData.length);
    if (longPad > 0) chunks.push(Buffer.alloc(longPad, 0));
  }

  chunks.push(buildHeader(entry.name, entry.data.length, "0", entry.mode ?? 0o644, entry.mtime ?? 0));
  chunks.push(entry.data);
  const padding = padToBlock(entry.data.length);
  if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
}

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    pushEntry(chunks, entry);
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2, 0));
  return Buffer.concat(chunks);
}

function parseTar(buffer) {
  const entries = [];
  let offset = 0;
  let pendingLongName = null;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);
    if (header.every(byte => byte === 0)) break;

    const headerName = header.subarray(0, 100).toString("ascii").replace(/\0.*$/, "");
    const typeflag = String.fromCharCode(header[156]);
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const modeField = header.subarray(100, 108).toString("ascii").replace(/\0.*$/, "").trim();
    const mode = parseInt(modeField, 8) || 0o644;

    offset += BLOCK_SIZE;
    const data = Buffer.from(buffer.subarray(offset, offset + size));
    offset += size + padToBlock(size);

    if (typeflag === "L" && headerName === GNU_LONGLINK) {
      pendingLongName = data.toString("utf-8").replace(/\0.*$/, "");
      continue;
    }

    const name = pendingLongName ?? headerName;
    pendingLongName = null;

    entries.push({ name, data, mode });
  }

  return entries;
}

function createTarGz(entries) { return gzipSync(createTar(entries)); }
function parseTarGz(buffer) { return parseTar(gunzipSync(buffer)); }

// Tests
const longName = "workspace/Alpha/blog/content/posts/как-зарегистрироваться-в-свой-в-альфе.md";
console.log(`Long name byte length: ${Buffer.byteLength(longName, "utf-8")} (>100: ${Buffer.byteLength(longName, "utf-8") > 100})`);

const entries = [
  { name: "manifest.json", data: Buffer.from('{"x":1}') },
  { name: longName, data: Buffer.from("# content") },
  { name: "short.txt", data: Buffer.from("short") },
];

const archive = createTarGz(entries);
const parsed = parseTarGz(archive);

console.log("\n--- Round-trip test ---");
for (let i = 0; i < entries.length; i++) {
  const nameMatch = parsed[i].name === entries[i].name;
  const dataMatch = parsed[i].data.equals(entries[i].data);
  console.log(`Entry ${i}: name=${nameMatch ? 'OK' : 'FAIL'}, data=${dataMatch ? 'OK' : 'FAIL'}`);
  if (!nameMatch) {
    console.log(`  Expected: ${entries[i].name}`);
    console.log(`  Got:      ${parsed[i].name}`);
  }
}

console.log(`\nTotal entries: expected ${entries.length}, got ${parsed.length}`);
