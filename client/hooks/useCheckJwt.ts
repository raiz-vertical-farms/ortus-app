import { useLocation, useRouter } from "@tanstack/react-router";
import { jwtDecode } from "jwt-decode";
import { useEffect, useMemo } from "react";

export function useCheckJWT() {
  const router = useRouter();
  const location = useLocation();
  useEffect(() => {
    try {
      const jwt = localStorage.getItem("token");
      if (jwt) {
        const decoded: { exp: number; iat: number; sub: string } =
          jwtDecode(jwt);
        const currentTime = Math.floor(Date.now() / 1000);
        if (decoded.exp < currentTime) {
          console.log("JWT has expired");
          router.navigate({ to: "/signup" });
          localStorage.removeItem("token");
        }
      } else {
        router.navigate({ to: "/signup" });
        console.log("No JWT found");
      }
    } catch (error) {
      router.navigate({ to: "/signup" });
      console.error("Error checking JWT:", error);
    }
  }, [location.pathname]);

  const isValid = useMemo(() => {
    try {
      const jwt = localStorage.getItem("token");
      if (jwt) {
        const decoded: { exp: number; iat: number; sub: string } =
          jwtDecode(jwt);
        const currentTime = Math.floor(Date.now() / 1000);
        return decoded.exp >= currentTime;
      }
      return false;
    } catch (error) {
      console.error("Error checking JWT:", error);
      return false;
    }
  }, [location.pathname]);

  return isValid;
}
