import {
  compileGenerative,
  isGenerativeModule,
} from "@assistant-ui/x-generative-compiler";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "assistant-ui-use-generative",
      enforce: "pre",
      transform(code, id) {
        if (id.includes("/node_modules/") || !isGenerativeModule(code)) return null;
        const { code: compiled } = compileGenerative(code, {
          target: "client",
          filename: id.split("?", 1)[0],
        });
        return { code: compiled };
      },
    },
  ],
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  test: {
    environment: "jsdom",
    include: ["components/**/*.test.tsx", "lib/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
