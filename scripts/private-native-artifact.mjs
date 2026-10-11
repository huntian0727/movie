// Standard RSA-OAEP + AES-256-GCM envelope for private CI candidates.
// Public Actions receives ciphertext only. The private key stays in ignored .tmp.
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validatePublicKey(pem) {
  if (typeof pem !== "string" || !pem.trim().startsWith("-----BEGIN PUBLIC KEY-----") || pem.includes("PRIVATE KEY")) throw new Error("Only an RSA public key is accepted");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 3072) throw new Error("A 3072-bit or larger RSA public key is required");
  return key;
}

export function seal(bytes, publicKey) {
  const recipient = validatePublicKey(publicKey);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const wrapped = publicEncrypt({ key: recipient, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  return { schemaVersion: 1, algorithm: "RSA-OAEP-SHA256+AES-256-GCM", key: wrapped.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), encrypted: encrypted.toString("base64") };
}

export function unseal(data, privateKey) {
  if (data.schemaVersion !== 1 || data.algorithm !== "RSA-OAEP-SHA256+AES-256-GCM") throw new Error("Unknown private candidate envelope");
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(data.key, "base64"));
  const iv = Buffer.from(data.iv, "base64"), tag = Buffer.from(data.tag, "base64");
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error("Invalid private candidate envelope");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(data.encrypted, "base64")), cipher.final()]);
}

async function createNewFile(file, bytes) {
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
}

async function main() {
  const [command, input, output, keyFile] = process.argv.slice(2);
  if (command === "validate-recipient") {
    validatePublicKey(Buffer.from(process.env.CANDIDATE_PUBLIC_KEY_BASE64 ?? "", "base64").toString("utf8"));
    console.log("RSA public recipient validated.");
  } else if (command === "keygen") {
    const directory = path.resolve(input);
    if (!directory.split(path.sep).includes(".tmp")) throw new Error("Private keys must stay in ignored .tmp");
    await mkdir(directory, { recursive: true });
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    await createNewFile(path.join(directory, "candidate-private.pem"), pair.privateKey);
    await createNewFile(path.join(directory, "candidate-public.pem"), pair.publicKey);
    console.log("Private candidate key created in ignored workspace storage.");
  } else if (command === "seal") {
    const info = await lstat(input);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Expected candidate archive");
    const key = Buffer.from(process.env.CANDIDATE_PUBLIC_KEY_BASE64 ?? "", "base64").toString("utf8");
    const envelope = seal(await readFile(input), key);
    await createNewFile(output, JSON.stringify(envelope));
    console.log("Private candidate encrypted; no binary is published.");
  } else if (command === "unseal") {
    if (!path.resolve(output).split(path.sep).includes(".tmp")) throw new Error("Candidate extraction must stay in ignored .tmp");
    const bytes = unseal(JSON.parse(await readFile(input, "utf8")), await readFile(keyFile, "utf8"));
    await createNewFile(output, bytes);
    console.log(JSON.stringify({ candidateBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), approved: false }));
  } else throw new Error("Expected keygen, seal or unseal");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
