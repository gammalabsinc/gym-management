import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: { "react-native": fileURLToPath(new URL("./test/react-native.tsx", import.meta.url)) },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
