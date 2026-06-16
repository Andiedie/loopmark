import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/shared/**/*.ts", "src/server/**/*.ts", "src/cli/**/*.ts", "src/ui/**/*.tsx"],
      exclude: ["src/**/*.d.ts", "src/cli/index.ts", "src/main.tsx", "src/components/ui/**/*.tsx"],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85
      }
    }
  }
});
