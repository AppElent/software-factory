import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useState } from "react";
import type { Mode } from "../shared/types.ts";
import { api } from "./api.ts";
import { Button, CodeBlock, ConfirmDialog, FormDialog, InlineError, StatusLine } from "./kit.tsx";
import { useModes } from "./queries.ts";

/** What a run needs from you first, for a mode that merges on its own. */
export interface ModeConfirm {
	title: string;
	description: string;
	action: string;
}

/** A body for `/api/work-orders`, or several when a button starts more than one. */
export type WorkOrderBody = Record<string, unknown>;

/** Asks the service for the command, since it holds the text an agent would get. */
export async function commandsFor(bodies: WorkOrderBody[], mode: Mode | null) {
	const out: string[] = [];
	for (const body of bodies) {
		const res = await api.post<{ command: string }>("/api/work-orders/command", { ...body, mode: mode?.id });
		out.push(res.command);
	}
	return out.join("\n");
}

/** Copies, and shows the command when the browser won't let it. */
export function useCopyCommand() {
	const [shown, setShown] = useState<string | null>(null);
	const [note, setNote] = useState<ReactNode>(null);
	const [error, setError] = useState<string | null>(null);
	const copy = async (make: () => Promise<string>) => {
		setError(null);
		setNote(null);
		try {
			const command = await make();
			try {
				await navigator.clipboard.writeText(command);
				setNote("Copied the command. It runs without this app.");
			} catch {
				setShown(command);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't build the command.");
		}
	};
	const view = (
		<>
			<StatusLine className="text-meta text-text-muted">{note}</StatusLine>
			<InlineError>{error}</InlineError>
			<FormDialog open={shown !== null} onOpenChange={(o) => !o && setShown(null)} title="Copy as command">
				<CodeBlock>{shown}</CodeBlock>
				<p className="m-0 text-meta text-text-muted">It runs without this app.</p>
				<div className="flex justify-end">
					<Button onClick={() => setShown(null)}>Close</Button>
				</div>
			</FormDialog>
		</>
	);
	return { copy, view };
}

const MENU =
	"z-30 box-border flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-0.5 rounded-md border border-solid border-border-control bg-bg-raised p-1 shadow-dialog";
const ITEM =
	"flex cursor-pointer items-start gap-2 rounded-sm px-3 py-2 outline-none data-[highlighted]:bg-bg-active data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60";

/**
 * One filled button that runs the chosen mode, and a menu that changes it. It starts on your default mode each
 * time, so a mode that merges on its own is always a choice for this run and never left over from the last one.
 */
export function FixButton({
	label,
	run,
	commands,
	confirm,
	locked,
	grow,
	pending,
	secondary,
}: {
	label: (mode: Mode | null) => string;
	run: (mode: Mode | null, confirmed: boolean) => void;
	/** The bodies Copy as command turns into terminal commands. */
	commands?: () => WorkOrderBody[];
	/** Asks once more before this mode runs. */
	confirm?: (mode: Mode) => ModeConfirm | null;
	/** Why this mode can't be chosen here. */
	locked?: (mode: Mode) => string | null;
	grow?: boolean;
	pending?: boolean;
	secondary?: boolean;
}) {
	const q = useModes();
	const [chosenId, setChosenId] = useState<string | null>(null);
	const [asking, setAsking] = useState<ModeConfirm | null>(null);
	const { copy, view } = useCopyCommand();
	const modes = q.data?.modes ?? [];
	const fallback = modes.find((m) => m.id === q.data?.defaultMode) ?? null;
	const picked = modes.find((m) => m.id === chosenId) ?? fallback;
	// A mode that became locked since it was chosen, such as an issue edited on GitHub.
	const mode = picked && locked?.(picked) ? fallback : picked;

	const go = () => {
		const ask = mode ? confirm?.(mode) : null;
		if (ask) setAsking(ask);
		else run(mode, false);
	};
	const variant = secondary ? "secondary" : "primary";
	const edge = secondary ? "" : "border-0 border-s border-solid border-accent-on/40";
	return (
		<div className={grow ? "flex w-full flex-col gap-2" : "inline-flex flex-col gap-2"}>
			<span className="flex">
				<Button
					variant={variant}
					grow={grow}
					disabled={pending}
					className="min-w-0 flex-1 rounded-e-none"
					onClick={go}
				>
					{label(mode)}
				</Button>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<Button variant={variant} aria-label="Choose a mode" className={`rounded-s-none px-3 ${edge}`}>
							<span aria-hidden="true">▾</span>
						</Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							align="end"
							sideOffset={4}
							className={MENU}
							onKeyDown={(e) => {
								const m = modes[Number(e.key) - 1];
								if (m && !locked?.(m)) {
									e.preventDefault();
									setChosenId(m.id);
								}
							}}
						>
							<DropdownMenu.RadioGroup value={mode?.id ?? ""} onValueChange={setChosenId}>
								{modes.map((m, i) => {
									const why = locked?.(m);
									return (
										<DropdownMenu.RadioItem key={m.id} value={m.id} disabled={!!why} className={ITEM}>
											<span aria-hidden="true" className="w-3 flex-none pt-px">
												<DropdownMenu.ItemIndicator>●</DropdownMenu.ItemIndicator>
											</span>
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="font-medium">{m.name}</span>
												<span className="text-meta text-text-muted">{why ?? m.description}</span>
											</span>
											<span aria-hidden="true" className="font-mono text-data text-text-muted">
												{i + 1}
											</span>
										</DropdownMenu.RadioItem>
									);
								})}
							</DropdownMenu.RadioGroup>
							<DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
							<DropdownMenu.Item asChild className={ITEM}>
								<Link to="/settings/$section" params={{ section: "modes" }}>
									Edit modes
								</Link>
							</DropdownMenu.Item>
							{commands && (
								<DropdownMenu.Item
									className={ITEM}
									onSelect={() => void copy(() => commandsFor(commands(), mode))}
								>
									Copy as command
								</DropdownMenu.Item>
							)}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</span>
			{view}
			<ConfirmDialog
				open={!!asking}
				onOpenChange={(o) => !o && setAsking(null)}
				title={asking?.title}
				description={asking?.description}
				action={asking?.action}
				actionVariant="primary"
				onAction={() => {
					setAsking(null);
					run(mode, true);
				}}
			/>
		</div>
	);
}

/** The second question for a mode that merges by itself, on something already hurting people. */
export const confirmOnProductionError = (count: number) => (mode: Mode) =>
	mode.merge === "factory"
		? {
				title: `${mode.name} on ${count === 1 ? "a production error" : `${count} production errors`}?`,
				description:
					"The factory merges each fix as soon as its gates pass, without you reading it. Stopping the line still stops it.",
				action: `Start with ${mode.name}`,
			}
		: null;

/** "Fix 2 with Standard", or "Add 2 to Intake with Standard" when nothing can start right now. */
export function fixLabel(count: number, mode: Mode | null, atLimit: boolean, verb = "Fix") {
	const what = count === 1 ? "" : ` ${count}`;
	const start = atLimit ? `Add${what} to Intake` : `${verb}${what}`;
	return mode ? `${start} with ${mode.name}` : start;
}
