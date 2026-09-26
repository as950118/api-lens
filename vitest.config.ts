import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tacet/core": src("core"),
      "@tacet/extractor-typescript": src("extractor-typescript"),
      "@tacet/extractor-java": src("extractor-java"),
      "@tacet/cli": src("cli"),
      "@tacet/ai-anthropic": src("ai-anthropic"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
