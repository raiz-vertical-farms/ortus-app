import { createFileRoute } from "@tanstack/react-router";
import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";

export const Route = createFileRoute("/signup_/sso-callback")({
  component: SSOCallback,
});

function SSOCallback() {
  return <AuthenticateWithRedirectCallback />;
}
