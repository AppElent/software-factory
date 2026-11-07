#!/usr/bin/env node
/**
 * Scaffolds a new project, one step at a time. Each step checks whether it has already happened,
 * so a failed run resumes from where it stopped. --dry-run prints the commands without running them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({
	options: {
		step: { type: "string" },
		repo: { type: "string" },
		folder: { type: "string" },
		template: { type: "string", default: "bare" },
		visibility: { type: "string", default: "private" },
		description: { type: "string", default: "" },
		"dry-run": { type: "boolean", default: false },
		toolkit: { type: "string", default: join(homedir(), "Developer", "developer-tools") },
	},
});

const dry = o["dry-run"];
const { repo, folder, template, visibility, description, toolkit } = o;
if (!repo || !folder || !o.step) {
	console.error(
		"Usage: new-project.mjs --step repo|folder|template|baseline|t3 --repo owner/name --folder path",
	);
	process.exit(2);
}
const name = repo.split("/")[1];

const run = (cmd, args, cwd = folder) => {
	if (dry) {
		console.log(`$ ${cmd} ${args.join(" ")}`);
		return "";
	}
	return execFileSync(cmd, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10 * 60_000,
	});
};

const write = (path, text) => {
	if (dry) {
		console.log(`write ${path}`);
		return;
	}
	if (!existsSync(join(folder, path))) writeFileSync(join(folder, path), text);
};

/** Upstream tools make the app. The toolkit adds standards on top. */
const TEMPLATES = {
	expo: () => run("pnpm", ["dlx", "create-expo-app@latest", ".", "--template", "default", "--no-install"]),
	vite: () => run("pnpm", ["create", "vite@latest", ".", "--template", "react-ts"]),
	node: () => {
		write(
			"package.json",
			`${JSON.stringify({ name, private: true, type: "module", scripts: { start: "node src/index.ts", test: "node --test" }, dependencies: { hono: "^4.13.0" } }, null, "\t")}\n`,
		);
		if (!dry) mkdirSync(join(folder, "src"), { recursive: true });
		write(
			"src/index.ts",
			'import { Hono } from "hono";\n\nexport const app = new Hono();\napp.get("/", (c) => c.text("ok"));\n',
		);
	},
	bare: () => {},
};

/** The factory's gates read this. Its job name, `verify`, stands for typecheck, tests, and lint. */
const ciWorkflow = (node) => `name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${node}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run --if-present check
      - run: pnpm run --if-present typecheck
      - run: pnpm run --if-present test
      - run: pnpm run --if-present build
`;

/** The folder is about to get commits and a push. It has to be this project's checkout. */
const assertOrigin = () => {
	if (dry) return;
	const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: folder, encoding: "utf8" });
	const clean = url
		.trim()
		.replace(/\/$/, "")
		.replace(/\.git$/, "")
		.toLowerCase();
	const want = repo.toLowerCase();
	if (!clean.endsWith(`/${want}`) && !clean.endsWith(`:${want}`)) {
		console.error(`${folder} is a checkout of ${url.trim()}, not ${repo}. Nothing was changed.`);
		process.exit(1);
	}
};

const steps = {
	repo() {
		try {
			execFileSync("gh", ["repo", "view", repo, "--json", "name"], { stdio: "pipe" });
			return; // Already there from an earlier attempt.
		} catch {}
		run("gh", ["repo", "create", repo, `--${visibility}`, "--description", description], process.cwd());
	},
	folder() {
		if (existsSync(join(folder, ".git"))) return;
		run("gh", ["repo", "clone", repo, folder], process.cwd());
	},
	template() {
		assertOrigin();
		let hasCommit = false;
		if (!dry) {
			try {
				execFileSync("git", ["rev-parse", "HEAD"], { cwd: folder, stdio: "pipe" });
				hasCommit = true;
			} catch {}
		}
		if (hasCommit) {
			// The commit is here, but the push that followed it may be what failed.
			run("git", ["branch", "-M", "main"]);
			run("git", ["push", "-u", "origin", "main"]);
			return;
		}
		TEMPLATES[template]?.();
		write("README.md", `# ${name}\n\n${description}\n`);
		write(".gitignore", "node_modules\ndist\n.env*\n");
		run("git", ["add", "-A"]);
		run("git", ["commit", "-m", "First commit"]);
		run("git", ["branch", "-M", "main"]);
		run("git", ["push", "-u", "origin", "main"]);
	},
	baseline() {
		assertOrigin();
		// A fix may have merged since the last try.
		run("git", ["pull", "--ff-only", "origin", "main"]);
		const script =
			template === "expo" ? "baseline-mobile.mjs" : template === "vite" ? "baseline-web.mjs" : "baseline.mjs";
		run("node", [join(toolkit, "scripts", script), "--path", folder, "--apply"], process.cwd());
		const pkg = existsSync(join(folder, "package.json"));
		let red = null;
		if (pkg) {
			if (!dry) mkdirSync(join(folder, ".github", "workflows"), { recursive: true });
			write(".github/workflows/ci.yml", ciWorkflow(template === "node" ? 26 : 22));
			try {
				run("pnpm", ["install"]);
				for (const s of ["typecheck", "test", "check"]) {
					const scripts = dry
						? {}
						: (JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).scripts ?? {});
					if (scripts[s]) run("pnpm", [s]);
				}
			} catch (e) {
				red = e;
			}
		}
		// Red or green, it goes up. An agent fixing a red baseline needs the CI and the files on main.
		run("git", ["add", "-A"]);
		const status = dry ? "x" : run("git", ["status", "--porcelain"]);
		if (status.trim()) run("git", ["commit", "-m", "Add the toolkit baseline"]);
		// Always, because a retry finds a clean folder when only the push failed last time.
		run("git", ["push", "origin", "HEAD"]);
		if (red) throw red;
	},
	t3() {
		run("t3", ["project", "add", folder, "--title", name], process.cwd());
	},
};

const step = steps[o.step];
if (!step) {
	console.error(`Unknown step: ${o.step}`);
	process.exit(2);
}
try {
	step();
} catch (e) {
	// The owner reads this on the Failed page, so no stack trace.
	const said = `${e.stderr ?? ""}`.trim();
	console.error(
		e.code === "ENOENT" ? `${e.path} isn't installed, or the service can't find it.` : said || e.message,
	);
	process.exit(1);
}
