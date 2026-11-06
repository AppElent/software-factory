import { Toast } from "@base-ui/react/toast";

export function useToast() {
	const manager = Toast.useToastManager();
	return {
		success: (title: string, description?: string) =>
			manager.add({ title, description, type: "success" }),
		error: (title: string, description?: string) =>
			manager.add({
				title,
				description,
				type: "error",
				priority: "high",
				timeout: 8000,
			}),
		info: (title: string, description?: string) =>
			manager.add({ title, description, type: "info" }),
	};
}

function ToastList() {
	const { toasts } = Toast.useToastManager();
	return toasts.map((toast) => (
		<Toast.Root key={toast.id} toast={toast}>
			<Toast.Title />
			<Toast.Description />
			<Toast.Close aria-label="Dismiss notification">Dismiss</Toast.Close>
		</Toast.Root>
	));
}

export function ToastHost({ children }: { children: React.ReactNode }) {
	return (
		<Toast.Provider>
			{children}
			<Toast.Portal>
				<Toast.Viewport>
					<ToastList />
				</Toast.Viewport>
			</Toast.Portal>
		</Toast.Provider>
	);
}
