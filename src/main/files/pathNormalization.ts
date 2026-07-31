import path from "node:path";

/** Canonical comparison key for Windows local, UNC, SMB-mounted, and slash-mixed paths. */
export function normalizeManagedPath(input: string): string {
  const normalized = path.win32.normalize(input.trim().replaceAll("/", "\\"));
  return normalized.replace(/\\+$/, "").toLocaleLowerCase();
}

export function managedPathEquals(left: string, right: string): boolean {
  return normalizeManagedPath(left) === normalizeManagedPath(right);
}

export function isManagedPathWithin(candidate: string, parent: string): boolean {
  const candidateKey = normalizeManagedPath(candidate);
  const parentKey = normalizeManagedPath(parent);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}\\`);
}
