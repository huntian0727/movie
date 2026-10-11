import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { seal, unseal, validatePublicKey } from "../../scripts/private-native-artifact.mjs";

const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

test("private candidate round trip uses authenticated encryption and fresh randomness", () => {
  const bytes = Buffer.from("MZ private native candidate\0\xff", "binary");
  const first = seal(bytes, pair.publicKey), second = seal(bytes, pair.publicKey);
  assert.deepEqual(unseal(first, pair.privateKey), bytes);
  assert.notEqual(first.encrypted, second.encrypted);
  assert.notEqual(first.key, second.key);
  assert.notEqual(first.iv, second.iv);
  assert.equal(JSON.stringify(first).includes("private native candidate"), false);
});

test("modified ciphertext, authentication tag and unknown envelope fail closed", () => {
  const envelope = seal(Buffer.from("MZ fake dll"), pair.publicKey);
  for (const field of ["encrypted", "tag"]) {
    const bytes = Buffer.from(envelope[field], "base64");
    bytes[0] ^= 1;
    assert.throws(() => unseal({ ...envelope, [field]: bytes.toString("base64") }, pair.privateKey));
  }
  assert.throws(() => unseal({ ...envelope, algorithm: "plaintext" }, pair.privateKey), /Unknown/);
  assert.throws(() => unseal({ ...envelope, iv: "AA==" }, pair.privateKey), /Invalid/);
});

test("candidate cannot be decrypted with a different recipient key", () => {
  const wrong = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(() => unseal(seal(Buffer.from("MZ fake dll"), pair.publicKey), wrong));
});

test("recipient rejects private keys, small RSA keys and other algorithms", () => {
  assert.throws(() => validatePublicKey(pair.privateKey), /Only/);
  const small = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => validatePublicKey(small), /3072/);
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => validatePublicKey(ec), /RSA/);
});

test("source workflow never uploads a plaintext executable or grants publishing permissions", async () => {
  const body = await readFile(new URL("../../.github/workflows/native-source-candidate.yml", import.meta.url), "utf8");
  assert.match(body, /workflow_dispatch:/);
  assert.match(body, /contents: read/);
  assert.doesNotMatch(body, /contents: write|gh release|release-approval\.json|secrets\./);
  const uploads = body.split("uses: actions/upload-artifact@").slice(1);
  assert.equal(uploads.length, 2);
  for (const upload of uploads) {
    assert.doesNotMatch(upload, /path:[\s\S]*?(?:runtime\/|\.zip|\.exe|\.dll|private\.pem)/);
  }
  assert.match(body, /path: \.tmp\/native-private-output\//);
  assert.match(body, /source-evidence/);
  assert.match(body, /--download-only/);
  assert.match(body, /persist-credentials: false/);
});
