// @vitest-environment node
import http2 from "node:http2";
import { describe, expect, it, vi } from "vitest";
import { parseCloudDriveEndpoint } from "../../src/shared/cloudDriveEndpoint";
import { CloudDriveGrpcClient } from "../../src/main/clouddrive/grpcClient";
import { listConfiguredCloudDriveFolderRoots } from "../../src/main/clouddrive/mountedScanner";

describe("CloudDrive transport policy", () => {
  it.each([
    "http://127.0.0.1:19798", "http://localhost:19798", "http://[::1]:19798",
    "http://127.23.45.67:19798", "http://127.255.255.255:19798",
    "https://192.168.1.10:19798", "https://example.com"
  ])("accepts %s in the shared policy and actual client", (endpoint) => {
    expect(parseCloudDriveEndpoint(endpoint).origin).toBe(endpoint);
    const client = new CloudDriveGrpcClient({ endpoint, apiToken: "transport-test-value" });
    client.close();
  });
  it.each([
    "http://192.168.1.10:19798", "http://10.0.0.2", "http://example.com", "http://0.0.0.0",
    "http://localhost.example.com", "http://127.0.0.1.example.com", "http://[::ffff:127.0.0.1]",
    "ftp://127.0.0.1", "https://user:password@example.com", "https://example.com?token=value",
    "https://example.com/private", "https://example.com#fragment", "invalid-value"
  ])("rejects %s before opening a session or sending credentials", async (endpoint) => {
    const connect = vi.spyOn(http2, "connect");
    try {
      expect(() => parseCloudDriveEndpoint(endpoint)).toThrow("HTTPS");
      expect(() => new CloudDriveGrpcClient({ endpoint, apiToken: "transport-test-value" })).toThrow("HTTPS");
      await expect(listConfiguredCloudDriveFolderRoots({
        LOCAL_VIDEO_MANAGER_CLOUDDRIVE_ENDPOINT: endpoint, LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN: "transport-test-value"
      })).rejects.toThrow("HTTPS");
      expect(connect).not.toHaveBeenCalled();
    } finally { connect.mockRestore(); }
  });
});
