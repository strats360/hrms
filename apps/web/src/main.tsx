import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import "./styles/app.css";
import { SessionProvider } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/api";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
  // Every mutation error shows a toast unless the mutation handles it itself (meta.silent).
  mutationCache: new MutationCache({
    onError: (e, _v, _c, m) => {
      if (!m.meta?.silent) toast.error(errorMessage(e));
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: { background: "var(--inverse-bg)", color: "var(--inverse-fg)", border: 0, borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", fontFamily: "var(--font-body)", fontSize: 14 },
          }}
        />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
