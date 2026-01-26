import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [
      "packages/**/src/**/*.integration.test.ts",
      "tests/**/*.integration.test.ts",
    ],
  },
});
