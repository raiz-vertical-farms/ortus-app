import "./styles/variables.css";
import "./styles/global.css";
import { queryClient } from "./lib/apiClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/clerk-react";
import { routeTree } from "./routeTree";

const router = createRouter({ routeTree });

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key");
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    layout?: {
      center?: boolean;
      hideNav?: boolean;
      pageTitle?: string;
      backButton?: boolean;
      closeButton?: boolean;
      leftSection?: () => React.ReactNode;
      middleSection?: () => React.ReactNode;
      rightSection?: () => React.ReactNode;
    };
  }
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        signInForceRedirectUrl="/"
        signUpForceRedirectUrl="/"
        afterSignOutUrl="/signup"
      >
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ClerkProvider>
    </StrictMode>
  );
}
