import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkedFile, sha256 } from "./native-player-toolchain.mjs";

export function assertInputLock(lock) {
  if (lock.schemaVersion !== 1 || lock.repository !== "huntian0727/movie" || !Number.isSafeInteger(lock.releaseId) || lock.releaseId <= 0 ||
      !/^checkpoint-[a-zA-Z0-9-]+$/.test(lock.tag) || !Array.isArray(lock.assets) || lock.assets.length !== 2 ||
      new Set(lock.assets.map(a => a.destination)).size !== 2 || lock.assets.some(a =>
        !/^[a-z0-9-]+\.zip$/.test(a.name) || !["native-runtime.zip", "source-evidence.zip"].includes(a.destination) ||
        !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > 300_000_000 || !/^[a-f0-9]{64}$/.test(a.sha256))) throw new Error("Unsafe retained input lock.");
}

export async function downloadAsset(url, token, pin, request = fetch) {
  if (!/^https:\/\/api\.github\.com\/repos\/huntian0727\/movie\/releases\/assets\/\d+$/.test(url)) throw new Error("Unexpected asset API URL.");
  let response = await request(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const redirect = new URL(response.headers.get("location"));
    if (redirect.protocol !== "https:" || redirect.username || redirect.password ||
        !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(redirect.hostname)) throw new Error("Unexpected asset redirect host.");
    // The signed download URL needs no GitHub credential. Never forward it.
    response = await request(redirect.href, { redirect: "error", signal: AbortSignal.timeout(300_000) });
  }
  if (!response.ok) throw new Error("Retained input download failed: " + response.status);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > pin.bytes) throw new Error("Retained input exceeds pinned size.");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (size !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error("Retained input differs from pinned bytes/hash.");
  return bytes;
}

export async function prepareSourceReleaseInputs(root, token, request = fetch) {
  const lock = JSON.parse(await readFile(path.join(root, "scripts/native-source-inputs.lock.json"), "utf8"));
  assertInputLock(lock);
  const response = await request(`https://api.github.com/repos/${lock.repository}/releases/${lock.releaseId}?verification=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Cache-Control": "no-cache" }, redirect: "error", signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error("Private input draft is unavailable: " + response.status);
  const release = await response.json();
  if (release.id !== lock.releaseId || release.draft !== true || release.tag_name !== lock.tag || !Array.isArray(release.assets)) throw new Error("Retained input draft identity changed.");
  const metadata = [];
  for (const pin of lock.assets) {
    const matches = release.assets.filter(a => a.name === pin.name);
    if (matches.length !== 1 || matches[0].size !== pin.bytes || matches[0].state !== "uploaded" || !Number.isSafeInteger(matches[0].id)) throw new Error("Retained input asset missing or changed.");
    const destination = checkedFile(root, path.join(root, ".tmp/native-source-inputs", pin.destination));
    let bytes;
    try { bytes = await readFile(destination); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (bytes) {
      if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error("Existing retained input differs; refusing overwrite.");
    } else {
      bytes = await downloadAsset(`https://api.github.com/repos/${lock.repository}/releases/assets/${matches[0].id}`, token, pin, request);
      await writeFile(destination, bytes, { flag: "wx" });
    }
    metadata.push({ name: pin.name, bytes: pin.bytes, sha256: pin.sha256 });
  }
  const report = { schemaVersion: 1, releaseId: lock.releaseId, privateDraft: true, assets: metadata, publicReleaseApproved: false };
  await writeFile(checkedFile(root, path.join(root, ".tmp/native-source-inputs/transport-verification.json")), JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true }).trim();
  if (!token) throw new Error("Authenticated private input access is required.");
  const report = await prepareSourceReleaseInputs(root, token);
  if (process.env.GITHUB_ENV) {
    const archive = path.join(root, ".tmp/native-source-inputs/native-runtime.zip");
    if (/[\r\n]/.test(archive)) throw new Error("Unsafe workflow input path.");
    await appendFile(process.env.GITHUB_ENV, `MOVIE_SOURCE_NATIVE_ZIP=${archive}\nMOVIE_SOURCE_PLAYER_ZIP=${archive}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}
