import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

export function useRequireAuth(redirectTo = "/signup") {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    const isAtRedirectTo = router.state.location.pathname === redirectTo;
    if (isLoaded && !isSignedIn && !isAtRedirectTo) {
      router.navigate({ to: redirectTo });
    }
  }, [router.state.location.pathname, redirectTo, isLoaded, isSignedIn]);
}
