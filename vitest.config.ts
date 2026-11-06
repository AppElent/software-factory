import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		projects: [
			{
				extends: true,
				test: { name: "server", environment: "node", include: ["tests/server/**/*.test.ts", "tests/shared/**/*.test.ts"] },
			},
			{
				extends: true,
				test: { name: "web", environment: "jsdom", include: ["tests/web/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
			},
		],
	},
});
