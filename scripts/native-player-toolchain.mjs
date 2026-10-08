import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Reviewed Git pins, never redirects/global NuGet cache/runtime hash enrollment. */
export function verifyPackage(bytes, pin) {
  validateOfficialSource(pin);
  if (bytes.length !== pin.size || sha256(bytes) !== pin.sha256
    || createHash("sha512").update(bytes).digest("base64") !== pin.sha512) {
    throw new Error("Native compiler package does not match the reviewed official NuGet pin");
  }
}

function validateOfficialSource(pin) {
  const url = new URL(pin.url);
  if (url.origin !== "https://api.nuget.org" || url.username || url.password || url.search || url.hash
    || url.pathname !== `/v3-flatcontainer/${pin.id}/${pin.version}/${pin.id}.${pin.version}.nupkg`) throw new Error("Non-official toolchain source rejected");
}

export function checkedDirectory(root, target) {
  const base = realpathSync(root), resolved = path.resolve(target), relative = path.relative(base, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Toolchain path escapes owned repository");
  let current = base;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let info;
    try { info = lstatSync(current); }
    catch (error) { if (error.code !== "ENOENT") throw error; mkdirSync(current); info = lstatSync(current); }
    if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(current) !== current) throw new Error("Reparse or non-directory toolchain path rejected");
  }
  return resolved;
}

export function checkedFile(root, target) {
  checkedDirectory(root, path.dirname(target));
  try {
    const info = lstatSync(target);
    if (info.isSymbolicLink() || !info.isFile() || realpathSync(target) !== path.resolve(target)) throw new Error("Reparse or non-file toolchain path rejected");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
}

export async function acquirePackage(root, cache, pin) {
  checkedDirectory(root, cache);
  const archive = checkedFile(root, path.join(cache, `${pin.id}.${pin.version}.nupkg`));
  let bytes;
  try { bytes = readFileSync(archive); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    validateOfficialSource(pin);
    const response = await fetch(pin.url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error("Official NuGet compiler download failed");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > pin.size) throw new Error("Compiler download exceeds pinned size");
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    verifyPackage(bytes, pin);
    writeFileSync(archive, bytes, { flag: "wx" });
  }
  verifyPackage(bytes, pin);
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateArchiveName(name) {
  if (!name || name.length > 240 || /[\\:<>"|?*\x00-\x1f\x7f]/.test(name) || name.startsWith("/")
    || name.split("/").some((part, index, parts) => part === "." || part === ".." || (!part && index < parts.length - 1))
    || name.split("/").some(part => /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Unsafe compiler ZIP entry");
}

/** Preflight every entry before any write. ZIP64/encryption/symlinks are refused. */
export function readPinnedZip(bytes, selected) {
  let end = -1;
  for (let cursor = bytes.length - 22; cursor >= Math.max(0, bytes.length - 65_557); cursor--) {
    if (bytes.readUInt32LE(cursor) === 0x06054b50 && cursor + 22 + bytes.readUInt16LE(cursor + 20) === bytes.length) { end = cursor; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error("Unsupported compiler ZIP");
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16);
  if (count > 2000 || count !== bytes.readUInt16LE(end + 8) || start + bytes.readUInt32LE(end + 12) !== end) throw new Error("Invalid compiler ZIP directory");
  const entries = [], names = new Set(); let offset = start, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid compiler ZIP entry");
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42), attributes = bytes.readUInt32LE(offset + 38);
    if (offset + 46 + nameLength + extraLength + commentLength > end || (flags & 1) || ![0, 8].includes(method)
      || compressed === 0xffffffff || local === 0xffffffff || size > 32 * 1024 * 1024
      || ((attributes >>> 16) & 0xf000) === 0xa000 || (attributes & 0x400)) throw new Error("Unsafe compiler ZIP metadata");
    const encodedName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(encodedName);
    validateArchiveName(name);
    if (names.has(name.toLowerCase())) throw new Error("Duplicate compiler ZIP entry");
    names.add(name.toLowerCase()); expanded += size;
    if (expanded > 160 * 1024 * 1024) throw new Error("Compiler ZIP expansion exceeds limit");
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50
      || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw new Error("Compiler ZIP local metadata mismatch");
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    if (!bytes.subarray(local + 30, local + 30 + localNameLength).equals(encodedName)) throw new Error("Compiler ZIP name mismatch");
    const data = local + 30 + localNameLength + localExtraLength;
    if (data + compressed > start) throw new Error("Compiler ZIP data escapes archive");
    entries.push({ name, method, size, data, compressed, crc: bytes.readUInt32LE(offset + 16) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) throw new Error("Compiler ZIP directory size mismatch");
  const result = new Map();
  for (const entry of entries.filter(e => !e.name.endsWith("/") && selected(e.name))) {
    const packed = bytes.subarray(entry.data, entry.data + entry.compressed);
    const data = entry.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) });
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error("Compiler ZIP contents fail integrity check");
    result.set(entry.name, Buffer.from(data));
  }
  return result;
}

export function materializePinnedFiles(root, destination, entries) {
  checkedDirectory(root, destination);
  for (const [name, bytes] of entries) {
    validateArchiveName(name);
    const file = checkedFile(root, path.join(destination, ...name.split("/")));
    try {
      if (sha256(readFileSync(file)) !== sha256(bytes)) throw new Error("Cached compiler/reference contents differ from pinned NuGet package");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      writeFileSync(file, bytes, { flag: "wx" });
    }
  }
  // Adjacent unmanaged/DLL/config files can influence compiler loading. Do not
  // execute from a cache with extra unreviewed files, even if csc itself matches.
  const allowed = new Set(entries.keys());
  const visit = (directory, prefix = "") => {
    checkedDirectory(root, directory);
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${item.name}`, actual = path.join(directory, item.name);
      if (item.isDirectory()) {
        if (![...allowed].some(name => name.startsWith(`${relative}/`))) throw new Error("Unexpected cached compiler directory");
        visit(actual, `${relative}/`);
      } else {
        checkedFile(root, actual);
        if (!allowed.has(relative)) throw new Error("Unexpected cached compiler file");
      }
    }
  };
  visit(destination);
}

export function assertX64ManagedExecutable(bytes) {
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : -1;
  if (bytes.toString("ascii", 0, 2) !== "MZ" || pe < 64 || pe + 24 + 240 > bytes.length
    || bytes.readUInt32LE(pe) !== 0x00004550 || bytes.readUInt16LE(pe + 4) !== 0x8664
    || bytes.readUInt16LE(pe + 24) !== 0x20b || !(bytes.readUInt16LE(pe + 22) & 2)
    || bytes.readUInt32LE(pe + 24 + 112 + 14 * 8) === 0
    || bytes.readUInt32LE(pe + 24 + 112 + 4 * 8) !== 0) throw new Error("NativeHost output must be an unsigned x64 managed PE executable");
}
