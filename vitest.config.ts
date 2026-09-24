import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@apilens/core": src("core"),
      "@apilens/extractor-typescript": src("extractor-typescript"),
      "@apilens/extractor-java": src("extractor-java"),
      "@apilens/cli": src("cli"),
      "@apilens/ai-anthropic": src("ai-anthropic"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
