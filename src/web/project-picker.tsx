import { useNavigate, useSearch } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import { plural } from "./format.ts";
import { Button } from "./kit.tsx";
import { useProjects } from "./queries.ts";

/*
 * Which projects the lists show. It lives in `?projects=a,b`, so reload, Back and a shared link keep it, and in this
 * browser, so it follows you to the next page and the next visit. Empty means every project.
 */

const KEY = "sf:projects";

const parse = (raw: string | undefined) => (raw ? raw.split(",").filter(Boolean) : []);

function remembered(): string | undefined {
	try {
		return window.localStorage.getItem(KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function remember(value: string | undefined) {
	try {
		if (value) window.localStorage.setItem(KEY, value);
		else window.localStorage.removeItem(KEY);
	} catch {
		// Private windows can refuse storage. The URL still carries it.
	}
}

/** The chosen project slugs, minus any that are no longer in the factory. Empty means every project. */
export function useChosenProjects(): [string[], (next: string[]) => void] {
	const { projects: raw } = useSearch({ strict: false }) as { projects?: string };
	const navigate = useNavigate();
	const projects = useProjects();
	const chosen = useMemo(() => {
		// Read before the URL catches up, so a page never fetches every project first.
		const list = parse(raw ?? remembered());
		if (!projects.data) return list;
		const known = new Set(projects.data.map((p) => p.slug));
		return list.filter((slug) => known.has(slug));
	}, [raw, projects.data]);
	const set = useCallback(
		(next: string[]) => {
			const value = next.length ? next.join(",") : undefined;
			remember(value);
			void navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({ ...prev, projects: value }),
				replace: true,
				resetScroll: false,
			} as never);
		},
		[navigate],
	);
	return [chosen, set];
}

/** A page opened without `?projects=` gets the choice this browser remembers. A page opened with one remembers it. */
export function useRestoreChosenProjects() {
	const { projects: raw } = useSearch({ strict: false }) as { projects?: string };
	const navigate = useNavigate();
	useEffect(() => {
		// An explicit `?projects=` is a choice too: every project. Only a missing one restores.
		if (raw !== undefined) {
			remember(raw || undefined);
			return;
		}
		const saved = remembered();
		if (saved)
			void navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({ ...prev, projects: saved }),
				replace: true,
				resetScroll: false,
			} as never);
	}, [raw, navigate]);
}

const MENU =
	"z-30 box-border flex max-h-[70vh] w-[280px] max-w-[calc(100vw-32px)] flex-col gap-0.5 overflow-y-auto rounded-md border border-solid border-border-control bg-bg-raised p-1 shadow-dialog";
const ITEM =
	"flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 outline-none data-[highlighted]:bg-bg-active";

/** "Gather", "Gather and Golf", or "3 projects": the chosen projects in a sentence. */
export function useChosenWords(): string {
	const [chosen] = useChosenProjects();
	const projects = useProjects();
	const names = chosen.map((slug) => projects.data?.find((p) => p.slug === slug)?.name ?? slug);
	if (names.length <= 2) return names.join(" and ");
	return plural(names.length, "project");
}

/** The multi-select every filtered page shows in its header. The menu stays open while you tick. */
export function ProjectPicker({ triggerRef }: { triggerRef?: RefObject<HTMLButtonElement | null> }) {
	const projects = useProjects();
	const [chosen, setChosen] = useChosenProjects();
	const list = [...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
	const names = list.filter((p) => chosen.includes(p.slug)).map((p) => p.name);
	const label =
		chosen.length === 0
			? "All projects"
			: chosen.length === 1
				? (names[0] ?? chosen[0])
				: plural(chosen.length, "project");
	const toggle = (slug: string) =>
		setChosen(chosen.includes(slug) ? chosen.filter((s) => s !== slug) : [...chosen, slug]);
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger asChild>
				<Button ref={triggerRef} aria-label={`Projects: ${label}`}>
					<span className="text-text-muted">Projects</span>
					<span className="max-w-[200px] truncate">{label}</span>
					<span aria-hidden="true">▾</span>
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
					<DropdownMenu.CheckboxItem
						className={ITEM}
						checked={chosen.length === 0}
						onCheckedChange={() => setChosen([])}
						onSelect={(e) => e.preventDefault()}
					>
						<Tick />
						All projects
					</DropdownMenu.CheckboxItem>
					<DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
					{list.map((p) => (
						<DropdownMenu.CheckboxItem
							key={p.slug}
							className={ITEM}
							checked={chosen.includes(p.slug)}
							onCheckedChange={() => toggle(p.slug)}
							onSelect={(e) => e.preventDefault()}
						>
							<Tick />
							<span className="min-w-0 flex-1 truncate">{p.name}</span>
						</DropdownMenu.CheckboxItem>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

const Tick = () => (
	<span aria-hidden="true" className="w-3 flex-none">
		<DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
	</span>
);

/** Says a list is narrowed, so an empty or short list never reads as the whole factory. */
export function ChosenNote({ total }: { total?: number }) {
	const [chosen, setChosen] = useChosenProjects();
	const projects = useProjects();
	if (chosen.length === 0) return null;
	const of = total ?? projects.data?.length;
	return (
		<p className="m-0 text-meta text-text-muted">
			Showing {of ? `${chosen.length} of ${plural(of, "project")}` : plural(chosen.length, "project")}.{" "}
			<button
				type="button"
				className="lnk cursor-pointer border-0 bg-transparent p-0 text-meta"
				onClick={() => setChosen([])}
			>
				Show all
			</button>
		</p>
	);
}
