import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    dedupe: ["graphql"],
  },
  test: {
    exclude: ["node_modules", "dist", ".direnv", ".git"],
  },
});
