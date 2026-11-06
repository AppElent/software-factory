import { Link } from "@tanstack/react-router";
import { AlertDialog, Dialog } from "radix-ui";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	GATE_NAMES,
	type GateName,
	type GateState,
	type Gates,
	STAGES,
	type Stage,
} from "../shared/types.ts";

/* The design's components. Companion: "Components". Tokens only, never a raw colour. */

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ---------- glyphs ---------- */

export type GlyphKind = "ask" | "run" | "pass" | "fail" | "err" | "idle" | "gp" | "gf" | "gr" | "gi";

const c = {
	accent: "var(--color-accent-solid)",
	run: "var(--color-status-run)",
	pass: "var(--color-status-pass)",
	fail: "var(--color-status-fail)",
	muted: "var(--color-text-muted)",
};

const SHAPES: Record<GlyphKind, ReactNode> = {
	ask: <path d="M8 2 14 8 8 14 2 8Z" fill={c.accent} />,
	run: (
		<>
			<circle cx="8" cy="8" r="5.25" fill="none" stroke={c.run} strokeWidth="1.5" />
			<path d="M8 2.75a5.25 5.25 0 0 1 0 10.5Z" fill={c.run} />
		</>
	),
	pass: <circle cx="8" cy="8" r="5" fill={c.pass} />,
	fail: <path d="M4 4l8 8M12 4l-8 8" stroke={c.fail} strokeWidth="2" strokeLinecap="round" />,
	err: <path d="M8 2.5 14 13H2Z" fill={c.fail} />,
	idle: <circle cx="8" cy="8" r="4.5" fill="none" stroke={c.muted} strokeWidth="1.5" />,
	gp: <rect x="3" y="3" width="10" height="10" rx="1" fill={c.pass} />,
	gf: <path d="M4 4l8 8M12 4l-8 8" stroke={c.fail} strokeWidth="2" strokeLinecap="round" />,
	gr: (
		<>
			<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1" fill="none" stroke={c.run} strokeWidth="1.5" />
			<rect x="8" y="3.75" width="4.25" height="8.5" fill={c.run} />
		</>
	),
	gi: (
		<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1" fill="none" stroke={c.muted} strokeWidth="1.5" />
	),
};

/** Always beside text or inside a labelled group. Colour is never alone. */
export function Glyph({ kind, size = 16 }: { kind: GlyphKind; size?: number }) {
	return (
		<svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" className="block flex-none">
			{SHAPES[kind]}
		</svg>
	);
}

/* ---------- gates ---------- */

export const GATE_WORD: Record<GateState, string> = {
	not_set_up: "Not set up",
	not_started: "Not started",
	running: "Running",
	passed: "Passed",
	failed: "Failed",
	out_of_date: "Out of date",
};
const GATE_GLYPH: Record<GateState, GlyphKind> = {
	not_set_up: "gi",
	not_started: "gi",
	running: "gr",
	passed: "gp",
	failed: "gf",
	out_of_date: "gi",
};

/** Four square glyphs named in one label. */
export function GateRow({ gates }: { gates: Gates }) {
	const label = GATE_NAMES.map((n) => `${n} ${GATE_WORD[gates[n]].toLowerCase()}`).join(", ");
	return (
		<span role="img" aria-label={label} className="inline-flex">
			{GATE_NAMES.map((n) => (
				<Glyph key={n} kind={GATE_GLYPH[gates[n]]} size={14} />
			))}
		</span>
	);
}

/** Label and state per gate, in a pane. `notes` adds text after a gate's state. */
export function GateList({ gates, notes }: { gates: Gates; notes?: Partial<Record<GateName, ReactNode>> }) {
	return (
		<ul className="m-0 flex list-none flex-col gap-2 p-0">
			{GATE_NAMES.map((n) => (
				<li key={n} className="flex items-center gap-2">
					<Glyph kind={GATE_GLYPH[gates[n]]} size={14} />
					<span>{n}</span>
					<span className="ms-auto text-meta text-text-muted">{notes?.[n] ?? GATE_WORD[gates[n]]}</span>
				</li>
			))}
		</ul>
	);
}

/* ---------- buttons and links ---------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "dangerFill";

const BUTTON_BASE =
	"inline-flex items-center justify-center gap-2 box-border px-3 rounded-sm font-[inherit] whitespace-nowrap cursor-pointer disabled:opacity-60";
const BUTTON: Record<ButtonVariant, string> = {
	primary: "btn-filled min-h-action bg-accent-solid border-0 text-accent-on font-semibold",
	secondary:
		"btn-secondary min-h-control bg-transparent border border-solid border-border-control text-text-primary",
	danger:
		"btn-secondary min-h-control bg-transparent border border-solid border-border-control text-status-fail font-medium",
	dangerFill: "btn-filled min-h-action bg-status-fail border-0 text-accent-on font-semibold",
};

const buttonClass = (variant: ButtonVariant, grow?: boolean, className?: string) =>
	cx(BUTTON_BASE, BUTTON[variant], grow && "w-full", className);

export interface ButtonProps extends ComponentProps<"button"> {
	variant?: ButtonVariant;
	grow?: boolean;
}

/** One primary per view. */
export function Button({ variant = "secondary", grow, className, type = "button", ...rest }: ButtonProps) {
	return <button type={type} className={buttonClass(variant, grow, className)} {...rest} />;
}

/** `Link` props, with `params` spelled out: wrapping `Link` loses the route's own params type. */
type LinkProps = Omit<ComponentProps<typeof Link>, "params"> & { params?: Record<string, string> };

/** A button that navigates inside the app. Pass TanStack `to`, `params`, `search`. */
export function ButtonLink({
	variant = "secondary",
	grow,
	className,
	...rest
}: LinkProps & { variant?: ButtonVariant; grow?: boolean }) {
	return (
		<Link
			className={buttonClass(variant, grow, className as string | undefined)}
			{...(rest as ComponentProps<typeof Link>)}
		/>
	);
}

/** A button that opens something outside the app, such as GitHub or T3. */
export function ButtonOut({
	variant = "secondary",
	grow,
	className,
	...rest
}: ComponentProps<"a"> & { variant?: ButtonVariant; grow?: boolean }) {
	return <a target="_blank" rel="noreferrer" className={buttonClass(variant, grow, className)} {...rest} />;
}

export function Lnk({ muted, className, ...rest }: LinkProps & { muted?: boolean }) {
	return (
		<Link
			className={cx("lnk", muted && "lnk-muted", className as string | undefined)}
			{...(rest as ComponentProps<typeof Link>)}
		/>
	);
}

export function LnkOut({ muted, className, ...rest }: ComponentProps<"a"> & { muted?: boolean }) {
	return (
		<a target="_blank" rel="noreferrer" className={cx("lnk", muted && "lnk-muted", className)} {...rest} />
	);
}

/* ---------- text and blocks ---------- */

export const SectionLabel = ({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 }) => {
	const H = `h${level}` as "h2";
	return <H className="section-label">{children}</H>;
};

export const Muted = ({ children, className }: { children: ReactNode; className?: string }) => (
	<span className={cx("text-text-muted", className)}>{children}</span>
);

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
	<span className={cx("font-mono text-data tabular-nums", className)}>{children}</span>
);

export function Banner({
	glyph,
	title,
	body,
	actions,
	role,
}: {
	glyph?: GlyphKind;
	title: ReactNode;
	body?: ReactNode;
	actions?: ReactNode;
	role?: "alert" | "status";
}) {
	return (
		<div
			role={role}
			className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-solid border-border-subtle bg-bg-surface px-4 py-3"
		>
			{glyph && <Glyph kind={glyph} />}
			<div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
				<strong className="font-semibold">{title}</strong>
				{body && <span className="text-text-muted [overflow-wrap:anywhere]">{body}</span>}
			</div>
			{actions && <div className="flex flex-wrap gap-2">{actions}</div>}
		</div>
	);
}

/** rows: [label, value, mono?] */
export function Facts({ rows }: { rows: Array<[ReactNode, ReactNode, boolean?]> }) {
	return (
		<dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta">
			{rows.map(([k, v, isMono], i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the rows don't reorder.
				<div key={i} className="contents">
					<dt className="text-text-muted">{k}</dt>
					<dd className={cx("m-0", isMono && "font-mono [overflow-wrap:anywhere]")}>{v}</dd>
				</div>
			))}
		</dl>
	);
}

/** crumbs: [label, to?]. The last has no link. */
export function Breadcrumb({
	crumbs,
}: {
	crumbs: Array<{ label: ReactNode; link?: ComponentProps<typeof Link> }>;
}) {
	return (
		<nav aria-label="Breadcrumb">
			<ol className="m-0 flex list-none flex-wrap gap-1 p-0 text-meta text-text-muted">
				{crumbs.map((crumb, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: the crumbs don't reorder.
					<li key={i} className="flex gap-1">
						{i > 0 && <span aria-hidden="true">/</span>}
						{crumb.link ? (
							<Link className="lnk lnk-muted" {...crumb.link}>
								{crumb.label}
							</Link>
						) : (
							<span aria-current="page">{crumb.label}</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

export const CodeBlock = ({ children }: { children: ReactNode }) => (
	<pre className="m-0 whitespace-pre-wrap rounded-sm border border-solid border-border-subtle bg-bg-canvas p-3 font-mono text-data [overflow-wrap:anywhere]">
		{children}
	</pre>
);

export const Skeleton = ({ width, height = 12 }: { width: string; height?: number }) => (
	<div style={{ width, height }} className="rounded-[4px] bg-bg-raised" />
);

/** `Couldn't {verb} this. Try again.` or the service's own words, right by the control. */
export const InlineError = ({ children }: { children: ReactNode }) =>
	children ? (
		<div role="alert" className="flex items-start gap-2 text-status-fail">
			<Glyph kind="fail" size={14} />
			<span className="[overflow-wrap:anywhere]">{children}</span>
		</div>
	) : null;

/** Render this empty at mount, so a later result announces. */
export const StatusLine = ({ children, className }: { children?: ReactNode; className?: string }) => (
	<div role="status" className={className}>
		{children}
	</div>
);

/* ---------- layout ---------- */

/** Page header: title, summary, and actions on one wrapping line. */
export function PageHeader({
	title,
	summary,
	actions,
}: {
	title: ReactNode;
	summary?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
			<h1 className="m-0 text-page-title">{title}</h1>
			{summary && <span className="text-text-muted">{summary}</span>}
			{actions && <span className="ms-auto flex flex-wrap gap-2">{actions}</span>}
		</div>
	);
}

/** The right-hand pane. Render it as a sibling of the page's content inside <Page>. */
export const Pane = ({ children }: { children: ReactNode }) => (
	<aside
		aria-label="Details"
		className="sf-pane box-border flex min-w-[300px] max-w-[380px] flex-[1_1_340px] flex-col gap-4 border-0 border-s border-solid border-border-subtle bg-bg-surface p-5"
	>
		{children}
	</aside>
);

/** Main and optional pane, wrapping at phone width. Goes directly inside the shell. */
export function Page({ children, pane }: { children: ReactNode; pane?: ReactNode }) {
	return (
		<div className="flex min-h-screen min-w-0 flex-[999_1_560px] flex-wrap items-stretch">
			<main id="main" className="sf-main flex min-w-0 flex-[999_1_560px] flex-col gap-4 px-6 py-4">
				{children}
			</main>
			{pane}
		</div>
	);
}

/* ---------- forms ---------- */

export function Field({
	label,
	hint,
	error,
	children,
}: {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	/** Receives the id and the describing ids. Spread them on the control. */
	children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
	const id = useId();
	const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="font-medium">
				{label}
			</label>
			{children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
			{hint && (
				<span id={`${id}-hint`} className="text-meta text-text-muted">
					{hint}
				</span>
			)}
			{error && (
				<span id={`${id}-error`} className="text-meta text-status-fail">
					{error}
				</span>
			)}
		</div>
	);
}

/** A radio or checkbox and its label as one target. */
export function Choice({
	title,
	description,
	...input
}: ComponentProps<"input"> & { title: ReactNode; description?: ReactNode }) {
	return (
		<label className="hover-row flex cursor-pointer items-start gap-2 rounded-sm px-3 py-2">
			<input {...input} className="mt-0.5" />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="font-medium">{title}</span>
				{description && <span className="text-meta text-text-muted">{description}</span>}
			</span>
		</label>
	);
}

/** Keeps the raw text, validates on blur, shows the error inline, and keeps the value on a failed save. */
export function NumberField({
	label,
	hint,
	value,
	validate,
	onCommit,
	width = 80,
}: {
	label: ReactNode;
	hint?: ReactNode;
	value: number;
	/** Returns the error text, or null. */
	validate: (n: number) => string | null;
	onCommit: (n: number) => void;
	width?: number;
}) {
	const [text, setText] = useState(String(value));
	const [error, setError] = useState<string | null>(null);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setText(String(value));
	}, [value]);
	const commit = () => {
		focused.current = false;
		const n = Number(text.trim());
		const problem = text.trim() === "" || Number.isNaN(n) ? validate(Number.NaN) : validate(n);
		setError(problem);
		if (!problem && n !== value) onCommit(n);
	};
	return (
		<Field label={label} hint={hint} error={error}>
			{(p) => (
				<input
					{...p}
					type="text"
					inputMode="numeric"
					value={text}
					style={{ width }}
					className="font-mono"
					onFocus={() => {
						focused.current = true;
					}}
					onChange={(e) => setText(e.target.value)}
					onBlur={commit}
				/>
			)}
		</Field>
	);
}

/* ---------- dialogs ---------- */

const OVERLAY = "fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-scrim px-4 pb-4 pt-24";
const DIALOG =
	"box-border flex w-full flex-col gap-4 rounded-md border border-solid border-border-control bg-bg-raised p-5 shadow-dialog";

/** Focus starts on Cancel, and returns to the opener on close. */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	cancel = "Cancel",
	action,
	actionVariant = "dangerFill",
	onAction,
	pending,
	error,
	width = 480,
	extra,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	cancel?: string;
	/** Leave it out when the dialog only explains why something can't happen. */
	action?: ReactNode;
	actionVariant?: ButtonVariant;
	onAction?: () => void;
	pending?: boolean;
	error?: ReactNode;
	width?: number;
	/** More buttons, shown between Cancel and the action. */
	extra?: ReactNode;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	const opener = useRef<HTMLElement | null>(null);
	return (
		<AlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialog.Portal>
				<AlertDialog.Overlay className={OVERLAY}>
					<AlertDialog.Content
						className={DIALOG}
						style={{ maxWidth: width }}
						onOpenAutoFocus={(e) => {
							e.preventDefault();
							opener.current = document.activeElement as HTMLElement | null;
							cancelRef.current?.focus();
						}}
						onCloseAutoFocus={(e) => {
							e.preventDefault();
							if (opener.current?.isConnected) opener.current.focus();
						}}
					>
						<AlertDialog.Title className="m-0 text-detail-title">{title}</AlertDialog.Title>
						<AlertDialog.Description
							asChild={typeof description !== "string"}
							className="m-0 text-text-muted"
						>
							{description ?? <span />}
						</AlertDialog.Description>
						{children}
						<InlineError>{error}</InlineError>
						<div className="flex flex-wrap justify-end gap-2">
							<AlertDialog.Cancel asChild>
								<Button ref={cancelRef}>{cancel}</Button>
							</AlertDialog.Cancel>
							{extra}
							{action && (
								<Button variant={actionVariant} disabled={pending} onClick={onAction}>
									{action}
								</Button>
							)}
						</div>
					</AlertDialog.Content>
				</AlertDialog.Overlay>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}

export function FormDialog({
	open,
	onOpenChange,
	title,
	children,
	width = 520,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	children: ReactNode;
	width?: number;
}) {
	const opener = useRef<HTMLElement | null>(null);
	// Read while rendering the open: a field inside takes focus before onOpenAutoFocus would run.
	const wasOpen = useRef(false);
	if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
	wasOpen.current = open;
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className={OVERLAY}>
					<Dialog.Content
						className={DIALOG}
						style={{ maxWidth: width }}
						aria-describedby={undefined}
						onCloseAutoFocus={(e) => {
							e.preventDefault();
							if (opener.current?.isConnected) opener.current.focus();
						}}
					>
						<Dialog.Title className="m-0 text-detail-title">{title}</Dialog.Title>
						{children}
					</Dialog.Content>
				</Dialog.Overlay>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** Expands in place. Focus moves to the safe button, and Keep returns it to the opener. */
export function InlineConfirm({
	label,
	variant = "danger",
	title,
	keep = "Keep",
	confirm,
	onConfirm,
	pending,
	error,
	grow = true,
}: {
	label: ReactNode;
	variant?: ButtonVariant;
	title: ReactNode;
	keep?: ReactNode;
	confirm: ReactNode;
	onConfirm: () => void;
	pending?: boolean;
	error?: ReactNode;
	grow?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const opener = useRef<HTMLButtonElement>(null);
	const safe = useRef<HTMLButtonElement>(null);
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open) safe.current?.focus();
		else if (wasOpen.current) opener.current?.focus();
		wasOpen.current = open;
	}, [open]);
	if (!open) {
		return (
			<Button ref={opener} variant={variant} grow={grow} onClick={() => setOpen(true)}>
				{label}
			</Button>
		);
	}
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Escape closes it, as the keyboard table requires.
		<div
			className="flex flex-col gap-2 rounded-sm border border-solid border-border-control p-3"
			onKeyDown={(e) => {
				if (e.key === "Escape") setOpen(false);
			}}
		>
			<div>{title}</div>
			<InlineError>{error}</InlineError>
			<div className="flex flex-wrap gap-2">
				<Button ref={safe} onClick={() => setOpen(false)}>
					{keep}
				</Button>
				<Button variant="danger" disabled={pending} onClick={onConfirm}>
					{confirm}
				</Button>
			</div>
		</div>
	);
}

/* ---------- lists ---------- */

export function BulkBar({
	count,
	onClear,
	children,
}: {
	count: number;
	onClear: () => void;
	children: ReactNode;
}) {
	return (
		<section
			aria-label="Bulk actions"
			className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-md border border-solid border-border-control bg-bg-raised px-4 py-2 shadow-dialog"
		>
			<span role="status" className="font-medium">
				{count} selected
			</span>
			<Button onClick={onClear}>Clear</Button>
			<span className="ms-auto flex flex-wrap gap-2">{children}</span>
		</section>
	);
}

export function Histogram({
	values,
	label,
	spike,
	height = 48,
	unit = "",
	tip,
}: {
	values: number[];
	label: string;
	spike?: (v: number, i: number) => boolean;
	height?: number;
	unit?: string;
	/** The title for one bar, when "3m" alone doesn't say enough. */
	tip?: (v: number, i: number) => string;
}) {
	const max = Math.max(1, ...values);
	return (
		<div role="img" aria-label={label} className="flex items-end gap-0.5" style={{ height }}>
			{values.map((v, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional.
					key={i}
					title={tip ? tip(v, i) : `${v}${unit}`}
					className={cx("flex-[1_1_0] rounded-t-[2px]", spike?.(v, i) ? "bg-status-fail" : "bg-border-input")}
					style={{ height: Math.max(2, Math.round((v / max) * height)) }}
				/>
			))}
		</div>
	);
}

/** Seven stages with the current step. */
export function StageTrack({
	current,
	glyph = "run",
	label = "Stages",
}: {
	current: Stage;
	/** The current step's glyph, matching the work order's status line. */
	glyph?: GlyphKind;
	label?: string;
}) {
	const at = STAGES.indexOf(current);
	return (
		<ol
			aria-label={label}
			className="m-0 grid list-none grid-cols-[repeat(7,minmax(84px,1fr))] overflow-x-auto rounded-sm border border-solid border-border-subtle p-0"
		>
			{STAGES.map((s, i) => (
				<li
					key={s}
					aria-current={i === at ? "step" : undefined}
					className={cx(
						"flex min-h-control items-center gap-2 px-3",
						i > 0 && "border-0 border-s border-solid border-border-subtle",
						i === at && "bg-bg-raised font-semibold",
						i > at && "text-text-muted",
					)}
				>
					<Glyph kind={i < at ? "pass" : i === at ? glyph : "idle"} size={14} />
					<span>{s}</span>
				</li>
			))}
		</ol>
	);
}

/** Re-renders on an interval, so ages on a page left open stay true. */
export function useTick(ms = 30_000) {
	const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), ms);
		return () => clearInterval(t);
	}, [ms]);
}

/** `No results` and other centered panels. */
export const EmptyPanel = ({
	title,
	body,
	children,
}: {
	title: ReactNode;
	body?: ReactNode;
	children?: ReactNode;
}) => (
	<div className="flex flex-col items-start gap-2 rounded-md border border-solid border-border-subtle p-6">
		<strong className="text-detail-title">{title}</strong>
		{body && <span className="text-text-muted">{body}</span>}
		{children}
	</div>
);

/** A failed page load. Never shows old data as empty. */
export const LoadFailed = ({ what, error }: { what: string; error: unknown }) => (
	<Banner
		role="alert"
		glyph="err"
		title={`Couldn't load ${what}.`}
		body={error instanceof Error ? error.message : undefined}
	/>
);
