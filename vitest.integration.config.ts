import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config();

export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    testTimeout: 120000,
  },
});
