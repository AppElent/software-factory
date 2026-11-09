import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { Breadcrumb, Page, SectionLabel } from "../kit.tsx";
import { useErrors, usePrs, useWorkOrders } from "../queries.ts";

/** Sample wording. Clicking one opens the same kind of page a real notification would. */

interface To {
	to: string;
	params?: Record<string, string>;
}

function Sample({
	title,
	message,
	opens,
	link,
}: {
	title: string;
	message: string;
	opens: string;
	link: To;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Link
				{...(link as ComponentProps<typeof Link>)}
				className="hover-card flex gap-3 rounded-md border border-solid border-border-control bg-bg-raised p-3"
			>
				<span
					aria-hidden="true"
					className="flex size-8 flex-none items-center justify-center rounded-sm bg-accent-solid font-semibold text-accent-on"
				>
					SF
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="text-meta text-text-muted">Software Factory</span>
					<span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
					<span className="[overflow-wrap:anywhere]">{message}</span>
				</span>
			</Link>
			<span className="text-meta text-text-muted">{opens}</span>
		</div>
	);
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4";

export function NotificationSamplesScreen() {
	const work = useWorkOrders();
	const prs = usePrs();
	const errors = useErrors();

	const FLOOR: To = { to: "/floor" };
	const workOrder = (state: string): To => {
		const w = work.data?.find((x) => x.state === state);
		return w ? { to: "/work-orders/$id", params: { id: String(w.id) } } : FLOOR;
	};
	const firstPr = prs.data?.[0];
	const pr: To = firstPr
		? { to: "/prs/$project/$number", params: { project: firstPr.project, number: String(firstPr.number) } }
		: { to: "/prs" };
	const error = (kind: string): To => {
		const e = errors.data?.errors.find((x) => x.kind === kind) ?? errors.data?.errors[0];
		return e ? { to: "/errors/$id", params: { id: e.id } } : { to: "/errors" };
	};

	return (
		<Page>
			<div className="flex flex-col gap-5">
				<Breadcrumb
					crumbs={[
						{ label: "Settings", link: { to: "/settings/$section", params: { section: "agents" } } as never },
						{
							label: "Notifications",
							link: { to: "/settings/$section", params: { section: "notifications" } } as never,
						},
						{ label: "How they read" },
					]}
				/>
				<h1 className="m-0 text-page-title">How notifications read</h1>
				<section aria-label="Needs you" className="flex flex-col gap-3">
					<SectionLabel>Needs you</SectionLabel>
					<div className={GRID}>
						<Sample
							title="Foundry: agent asks a question"
							message="WO-212: Keep the old migration?"
							opens="Opens the question"
							link={workOrder("question")}
						/>
						<Sample
							title="Fairway: plan ready for you"
							message="WO-214: Fix TypeError reading 'holes'"
							opens="Opens the plan"
							link={workOrder("plan_ready")}
						/>
						<Sample
							title="Foundry: PR ready to merge"
							message="#168 Sync toolkit standards. All 4 gates passed."
							opens="Opens the PR"
							link={pr}
						/>
						<Sample
							title="Arcade Club: tests failed twice"
							message="WO-213: Flaky leaderboard test"
							opens="Opens the work order"
							link={workOrder("failed")}
						/>
						<Sample
							title="Fairway: new production error"
							message="TypeError reading 'holes'. 14 users so far."
							opens="Opens the error"
							link={error("new")}
						/>
						<Sample
							title="Fairway: an error came back"
							message="NetworkError fetching course list. Its fix shipped 6 days ago."
							opens="Opens the error"
							link={error("regression")}
						/>
						<Sample
							title="Gather: CI red on main"
							message="Typecheck failed on f81c0de."
							opens="Opens the Queue, on that row"
							link={{ to: "/" }}
						/>
						<Sample
							title="3 PRs ready to merge"
							message="Arcade Club, satisfactory, and roadmaps"
							opens="Opens Pull requests"
							link={{ to: "/prs" }}
						/>
					</div>
				</section>
				<section aria-label="Just so you know" className="flex flex-col gap-3">
					<SectionLabel>Just so you know</SectionLabel>
					<div className={GRID}>
						<Sample
							title="Fairway: merged without you"
							message="#96 Fix TypeError reading 'holes'"
							opens="Opens the PR"
							link={pr}
						/>
						<Sample
							title="Foundry: shipped"
							message="WO-208: Faster workout list"
							opens="Opens the floor"
							link={FLOOR}
						/>
						<Sample
							title="All 3 agents are busy"
							message="2 work orders are waiting in Intake."
							opens="Opens the floor"
							link={FLOOR}
						/>
					</div>
				</section>
			</div>
		</Page>
	);
}
