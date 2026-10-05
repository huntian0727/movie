import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationFeedback, ReadState, operationErrorMessage } from "../../src/renderer/components/OperationFeedback";

afterEach(() => vi.useRealTimers());

describe("contextual operation feedback", () => {
  it("expires only successful transient notices, even while the parent rerenders", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const { rerender } = render(<OperationFeedback message="已保存" autoDismiss onDismiss={() => dismiss()} />);
    act(() => vi.advanceTimersByTime(4_000));
    rerender(<OperationFeedback message="已保存" autoDismiss onDismiss={() => dismiss()} />);
    act(() => vi.advanceTimersByTime(4_000));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it.each(["info", "warning", "error"] as const)("keeps %s visible until explicitly dismissed", (tone) => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<OperationFeedback message="需要查看结果" tone={tone} autoDismiss onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("cancels expiry of an old message and never executes retry automatically", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn(); const retry = vi.fn();
    const { rerender, unmount } = render(<OperationFeedback message="已保存" autoDismiss onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(7_000));
    rerender(<OperationFeedback message="读取失败" tone="error" autoDismiss onDismiss={dismiss} onRetry={retry} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(dismiss).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(retry).toHaveBeenCalledOnce();
    unmount(); act(() => vi.runAllTimers());
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("does not present a loading or failed read as an empty result", () => {
    const props = { empty: true, loadingText: "读取中", emptyTitle: "没有记录" };
    const { rerender } = render(<ReadState {...props} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("读取中");
    expect(screen.queryByText("没有记录")).not.toBeInTheDocument();
    rerender(<ReadState {...props} loading={false} error="offline" />);
    expect(screen.queryByText("没有记录")).not.toBeInTheDocument();
    rerender(<ReadState {...props} loading={false} />);
    expect(screen.getByText("没有记录")).toBeInTheDocument();
  });

  it("removes Electron wrappers without hiding safety refusals", () => {
    const reason = "Permanent deletion requires full SHA-256 verification and separate confirmation.";
    expect(operationErrorMessage(new Error(`Error invoking remote method 'video-data:delete': Error: ${reason}`))).toBe(reason);
    expect(operationErrorMessage(new Error("ENOENT: missing file"))).toBe("ENOENT: missing file");
    expect(operationErrorMessage(null)).toBe("操作失败，请稍后重试");
  });
});
