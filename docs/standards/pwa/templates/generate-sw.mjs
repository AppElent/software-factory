import { generateSW } from "workbox-build";

const { count, size, warnings } = await generateSW({
	globDirectory: "dist/client",
	globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
	swDest: "dist/client/sw.js",
	navigateFallbackDenylist: [/^\/api\//, /^\/convex\//],
	skipWaiting: true,
	clientsClaim: true,
});
for (const warning of warnings) console.warn(warning);
console.log(
	`generate-sw: precached ${count} files, ${(size / 1024).toFixed(1)} KB`,
);
