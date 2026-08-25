import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloudDriveFolderDialog } from "../../src/renderer/components/CloudDriveFolderDialog";

describe("CloudDriveFolderDialog", () => {
  it("browses API folders and adds the selected remote source", async () => {
    const listRoots = vi.fn(async () => [
      { mountPoint: "Y:", remotePath: "/aliyun", name: "阿里云", readOnly: false },
      { mountPoint: "Z:", remotePath: "/115", name: "115 网盘", readOnly: false }
    ]);
    const browse = vi.fn(async ({ mountPoint, remotePath }: { mountPoint: string; remotePath: string }) => ({
      mountPoint,
      localPath: remotePath === "/115" ? "Z:\\" : "Z:\\电影",
      remotePath,
      rootRemotePath: "/115",
      parentRemotePath: remotePath === "/115" ? null : "/115",
      name: "115 网盘",
      readOnly: false,
      directories: remotePath === "/115" ? [{ name: "电影", remotePath: "/115/电影" }] : [],
      directFileCount: 3,
      directVideoCount: 2
    }));
    const folder = {
      id: "folder-1", path: "Z:\\电影", recursive: true, enabled: true,
      lastScannedAt: null, createdAt: "now", updatedAt: "now", scanError: null,
      providerType: "clouddrive" as const, providerRootPath: "/115/电影"
    };
    const add = vi.fn(async () => folder);
    const onAdded = vi.fn();

    render(<CloudDriveFolderDialog
      listRoots={listRoots}
      browse={browse}
      add={add}
      onAdded={onAdded}
      onClose={vi.fn()}
    />);

    fireEvent.click(await screen.findByRole("button", { name: /115 网盘/ }));
    fireEvent.click(await screen.findByRole("button", { name: /电影/ }));
    await screen.findByText("/115/电影");
    fireEvent.click(screen.getByRole("button", { name: "添加并扫描此目录" }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({ mountPoint: "Z:", remotePath: "/115/电影" }));
    expect(onAdded).toHaveBeenCalledWith(folder);
  });

  it("shows API connection failures without creating a source", async () => {
    render(<CloudDriveFolderDialog
      listRoots={async () => { throw new Error("CloudDrive API unavailable"); }}
      browse={vi.fn()}
      add={vi.fn()}
      onAdded={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(await screen.findByRole("alert")).toHaveTextContent("CloudDrive API unavailable");
    expect(screen.getByRole("button", { name: "添加并扫描此目录" })).toBeDisabled();
  });
});
