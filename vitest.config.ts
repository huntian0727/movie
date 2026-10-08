import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Large SQLite fixtures share the host disk; serialize files for reproducible budgets.
    maxWorkers: 1,
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.test.mjs"],
    setupFiles: ["tests/setup.ts"]
  }
});
