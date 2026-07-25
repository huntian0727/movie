export const REQUIRED_NODE_VERSION: string;
export const REQUIRED_NPM_VERSION: string;

export interface EnvironmentInspection {
  ok: boolean;
  nodeVersion: string | undefined;
  npmVersion: string | undefined;
  problems: string[];
}

export function parseNpmVersion(userAgent?: string): string | undefined;
export function inspectEnvironment(options?: {
  nodeVersion?: string;
  npmVersion?: string;
}): EnvironmentInspection;
export function formatEnvironmentError(result: EnvironmentInspection): string;
