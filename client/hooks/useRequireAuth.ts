import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

export function useRequireAuth(redirectTo = "/signup") {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    console.log({ isLoaded, isSignedIn, redirectTo });
    if (isLoaded && !isSignedIn) {
      //router.navigate({ to: redirectTo });
    }
  }, [router.latestLocation, redirectTo, isLoaded, isSignedIn]);
}
