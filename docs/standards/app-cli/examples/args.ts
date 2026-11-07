export class ArgsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgsError";
	}
}

const BOOLEAN_FLAGS = new Set(["help", "json"]);

export type ParsedArgs = {
	positionals: string[];
	flags: Record<string, string | boolean>;
};

export function parseArgs(args: string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags: Record<string, string | boolean> = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const raw = arg.slice(2);
			const [key, inlineValue] = raw.split("=", 2);
			if (BOOLEAN_FLAGS.has(key)) {
				if (inlineValue === undefined) {
					const next = args[i + 1];
					if (next === "true" || next === "false") {
						flags[key] = next === "true";
						i++;
						continue;
					}

					flags[key] = true;
					continue;
				}

				if (inlineValue === "true") {
					flags[key] = true;
					continue;
				}

				if (inlineValue === "false") {
					flags[key] = false;
					continue;
				}

				throw new ArgsError(`Invalid value for --${key}: ${inlineValue}`);
			}
			if (inlineValue !== undefined) {
				flags[key] = inlineValue;
				continue;
			}

			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags[key] = next;
				i++;
				continue;
			}

			flags[key] = true;
			continue;
		}

		if (arg === "-h") {
			flags.h = true;
			continue;
		}

		positionals.push(arg);
	}

	return { positionals, flags };
}

export function getStringFlag(
	flags: Record<string, string | boolean>,
	name: string,
): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}

export function hasFlag(
	flags: Record<string, string | boolean>,
	name: string,
): boolean {
	return flags[name] === true;
}
