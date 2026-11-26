import { defineProject } from "vitest/config";

// Database hooks create a database and run migrations, which can pass 10 seconds on a busy CI runner.
export default defineProject({
  test: { include: ["src/**/*.test.ts"], hookTimeout: 60000, testTimeout: 30000 },
});
