import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "extensions/**/*.test.ts"],
    typecheck: {
      enabled: false,
    },
  },
});
