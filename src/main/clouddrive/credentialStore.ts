import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SafeStorage } from "electron";
import { registerSensitiveValue } from "../logging/redaction.js";

export interface CloudDriveCredentialStore {
  readToken(): string;
  writeToken(token: string): void;
}

/** Main-process only. The file contains safeStorage ciphertext, never JSON/plaintext. */
export function createCloudDriveCredentialStore(
  root: string,
  encryption: Pick<SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString" | "getSelectedStorageBackend">,
  platform = process.platform
): CloudDriveCredentialStore {
  const file = path.join(root, "clouddrive-credentials.bin");
  const assertAvailable = () => {
    if (!encryption.isEncryptionAvailable() || (platform === "linux" && encryption.getSelectedStorageBackend() === "basic_text")) {
      throw new Error("系统安全存储不可用，无法读取或保存 CloudDrive Token");
    }
  };
  return {
    readToken() {
      let encrypted: Buffer;
      try { encrypted = readFileSync(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw new Error("CloudDrive 安全凭据无法读取，请检查数据目录权限");
      }
      assertAvailable();
      try {
        const token = encryption.decryptString(encrypted).trim();
        if (!token) throw new Error();
        registerSensitiveValue(token);
        return token;
      } catch { throw new Error("CloudDrive 安全凭据无法解密，请在设置中重新保存 Token"); }
    },
    writeToken(input) {
      const token = input.trim();
      if (!token) return; // A blank replacement always preserves the existing credential.
      registerSensitiveValue(token);
      assertAvailable();
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const encrypted = encryption.encryptString(token);
        if (encryption.decryptString(encrypted) !== token) throw new Error();
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const descriptor = openSync(temporary, "wx", 0o600);
        try { writeFileSync(descriptor, encrypted); fsyncSync(descriptor); }
        finally { closeSync(descriptor); }
        // Verify the durable copy before removing any legacy plaintext.
        if (encryption.decryptString(readFileSync(temporary)) !== token) throw new Error();
        renameSync(temporary, file);
      } catch { throw new Error("CloudDrive Token 无法安全保存，请检查系统安全存储和数据目录权限"); }
      finally { try { rmSync(temporary, { force: true }); } catch { /* No plaintext was written. */ } }
    }
  };
}
