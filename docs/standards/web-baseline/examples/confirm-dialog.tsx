import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
export type ConfirmOptions = {
	title: string;
	description?: string;
	confirmLabel: string;
	cancelLabel?: string;
	destructive?: boolean;
};
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);
export function ConfirmDialogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [options, setOptions] = useState<ConfirmOptions | null>(null);
	const resolveRef = useRef<((value: boolean) => void) | null>(null);
	const settle = useCallback((value: boolean) => {
		resolveRef.current?.(value);
		resolveRef.current = null;
		setOptions(null);
	}, []);
	const confirm = useCallback<Confirm>((next) => {
		resolveRef.current?.(false);
		setOptions(next);
		return new Promise((resolve) => {
			resolveRef.current = resolve;
		});
	}, []);
	useEffect(
		() => () => {
			resolveRef.current?.(false);
			resolveRef.current = null;
		},
		[],
	);
	return (
		<Context.Provider value={confirm}>
			{children}
			<AlertDialog.Root
				open={options !== null}
				onOpenChange={(open) => {
					if (!open) settle(false);
				}}
			>
				<AlertDialog.Portal>
					<AlertDialog.Backdrop />
					<AlertDialog.Popup>
						<AlertDialog.Title>{options?.title}</AlertDialog.Title>
						{options?.description ? (
							<AlertDialog.Description>
								{options.description}
							</AlertDialog.Description>
						) : null}
						<AlertDialog.Close>
							{options?.cancelLabel ?? "Cancel"}
						</AlertDialog.Close>
						<button
							type="button"
							data-destructive={options?.destructive || undefined}
							onClick={() => settle(true)}
						>
							{options?.confirmLabel}
						</button>
					</AlertDialog.Popup>
				</AlertDialog.Portal>
			</AlertDialog.Root>
		</Context.Provider>
	);
}
export function useConfirm(): Confirm {
	const value = useContext(Context);
	if (!value)
		throw new Error("useConfirm must be used within ConfirmDialogProvider");
	return value;
}
