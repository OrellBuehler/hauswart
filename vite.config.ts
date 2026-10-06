import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { paraglideOptions } from "./paraglide.config.ts";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    sveltekit(),
    ...(command === "serve" && !process.env.VITEST
      ? [
          paraglideVitePlugin({
            ...paraglideOptions,
            strategy: [...paraglideOptions.strategy],
          }),
        ]
      : []),
  ],
  // Native addons and font-bearing packages: loaded from node_modules at runtime, never bundled.
  ssr: {
    external: ["@napi-rs/canvas", "pdfmake"],
  },
  optimizeDeps: {
    exclude: ["@napi-rs/canvas", "pdfmake"],
  },
  build: {
    rollupOptions: {
      external: [/^bun:/],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./scripts/vitest-global-setup.ts"],
    setupFiles: ["./scripts/vitest-setup.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/components/ui/**", "src/lib/paraglide/**"],
      reporter: ["text", "json-summary"],
    },
  },
}));
