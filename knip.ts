import type { RawConfigurationOrFn } from "knip/dist/types/config.js";

const config: RawConfigurationOrFn = {
  ignore: [".direnv/**"],
  workspaces: {
    ".": {
      entry: [
        "caido.config.ts",
        "eslint.config.mjs",
        "tests/**/*.ts",
        "scripts/**/*.ts",
      ],
    },
    "packages/backend": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
      ignoreDependencies: ["caido", "sqlite"],
    },
    "packages/frontend": {
      entry: ["src/index.ts"],
      project: ["src/**/*.{ts,tsx,vue}"],
    },
  },
};

export default config;
