import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startLive } from "./live.ts";
import { router } from "./router.tsx";
import "./styles.css";

const client = new QueryClient({
	defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2000 } },
});

startLive(client);

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	);
}
