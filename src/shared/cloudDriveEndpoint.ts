const ENDPOINT_ERROR = "CloudDrive API 地址仅允许本机 loopback 使用 HTTP；其他地址必须使用 HTTPS，且不能包含账号、路径、查询参数或片段";

/** Validate the literal URL host, never a DNS lookup of an arbitrary hostname. */
export function parseCloudDriveEndpoint(value: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(value.trim()); }
  catch { throw new Error(ENDPOINT_ERROR); }
  const host = endpoint.hostname;
  const loopback = host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback))
    || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error(ENDPOINT_ERROR);
  }
  return endpoint;
}

export function isValidCloudDriveEndpoint(value: string): boolean {
  try { parseCloudDriveEndpoint(value); return true; }
  catch { return false; }
}
