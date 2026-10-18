import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataStorageSettings } from "../../src/renderer/components/DataStorageSettings";
import type { DataStorageApi } from "../../src/shared/dataStorage";

function api(): DataStorageApi {
  return {
    getDataStorage: vi.fn().mockResolvedValue({ currentDirectory: "C:\\old", defaultDirectory: "C:\\old", message: null }),
    openDataDirectory: vi.fn().mockResolvedValue(undefined),
    chooseDataDirectory: vi.fn().mockResolvedValue({ token: "preview-id", sourceDirectory: "C:\\old", targetDirectory: "D:\\映匣数据", fileCount: 12, totalBytes: 1048576, availableBytes: 1073741824 }),
    migrateDataDirectory: vi.fn().mockResolvedValue({ restarting: true })
  };
}
describe("data storage settings", () => {
  it("previews source, target and size, and starts only after explicit confirmation", async () => {
    const storage = api(); render(<DataStorageSettings api={storage} />);
    await screen.findByText("C:\\old");
    fireEvent.click(screen.getByRole("button", { name: "打开数据目录" })); expect(storage.openDataDirectory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
    await screen.findByRole("alertdialog");
    expect(screen.getByText(/新位置/)).toHaveTextContent("D:\\映匣数据");
    expect(screen.getByText(/将迁移 12/)).toHaveTextContent("1.0 MB");
    expect(storage.migrateDataDirectory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "迁移并重启" }));
    await waitFor(() => expect(storage.migrateDataDirectory).toHaveBeenCalledWith("preview-id"));
    expect(screen.getByRole("button", { name: "迁移并重启" })).toBeDisabled();
  });
  it("supports cancelling both the native picker and the confirmation", async () => {
    const storage = api(); vi.mocked(storage.chooseDataDirectory).mockResolvedValueOnce(null);
    render(<DataStorageSettings api={storage} />); await screen.findByText("C:\\old");
    fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "更改位置" })).toBeEnabled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更改位置" })); await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(storage.migrateDataDirectory).not.toHaveBeenCalled();
  });
  it("displays migration failures and allows choosing another location", async () => {
    const storage = api(); vi.mocked(storage.migrateDataDirectory).mockRejectedValue(new Error("磁盘不可用，原数据已保留"));
    render(<DataStorageSettings api={storage} />); await screen.findByText("C:\\old");
    fireEvent.click(screen.getByRole("button", { name: "更改位置" })); await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "迁移并重启" }));
    await screen.findByText(/磁盘不可用/);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更改位置" })).toBeEnabled();
  });
});
