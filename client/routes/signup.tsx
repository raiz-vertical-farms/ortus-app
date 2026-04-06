import { createFileRoute, useMatch } from "@tanstack/react-router";
import PageLayout from "../layout/PageLayout/PageLayout";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import Container from "../primitives/Container/Container";
import Box from "../primitives/Box/Box";
import Button from "../primitives/Button/Button";
import { Text } from "../primitives/Text/Text";
import { Group } from "../primitives/Group/Group";
import Input from "../primitives/Input/Input";
import { useState } from "react";
import { GoogleLogo } from "@phosphor-icons/react";
import RaizLogo from "../icons/Logos/Raiz";

export const Route = createFileRoute("/signup")({
  component: Signup,
  staticData: { layout: { hideNav: true } },
});

function Signup() {
  const {
    isLoaded: isSignInLoaded,
    signIn,
    setActive: setSignInActive,
  } = useSignIn();
  const {
    isLoaded: isSignUpLoaded,
    signUp,
    setActive: setSignUpActive,
  } = useSignUp();
  const { staticData } = useMatch({ from: "/signup" });
  const layout = staticData.layout;

  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isSignInLoaded || !isSignUpLoaded) {
    return null;
  }

  const handleGoogleSignIn = async () => {
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/signup/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (err: any) {
      setError(err.errors?.[0]?.message || "Failed to sign in with Google");
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError("");

    try {
      // Try to sign in first
      try {
        const { supportedFirstFactors } = await signIn.create({
          identifier: email,
        });

        const isEmailCodeSupported = supportedFirstFactors?.some(
          (f: any) => f.strategy === "email_code",
        );

        if (isEmailCodeSupported && supportedFirstFactors) {
          await signIn.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId: (
              supportedFirstFactors.find(
                (f: any) => f.strategy === "email_code",
              ) as any
            ).emailAddressId,
          });
          setVerifying(true);
        }
      } catch (signInErr: any) {
        // If user not found, try to sign up
        if (signInErr.errors?.[0]?.code === "form_identifier_not_found") {
          await signUp.create({
            emailAddress: email,
          });
          await signUp.prepareEmailAddressVerification({
            strategy: "email_code",
          });
          setVerifying(true);
        } else {
          throw signInErr;
        }
      }
    } catch (err: any) {
      setError(
        err.errors?.[0]?.message || "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;

    setLoading(true);
    setError("");

    try {
      console.log("Attempting verification...", {
        signInStatus: signIn.status,
        signUpStatus: signUp.status,
      });

      if (signIn.status === "needs_first_factor") {
        const result = await signIn.attemptFirstFactor({
          strategy: "email_code",
          code,
        });

        if (result.status === "complete") {
          await setSignInActive({ session: result.createdSessionId });
        }
      } else if (signUp.status === "missing_requirements") {
        const result = await signUp.attemptEmailAddressVerification({
          code,
        });

        if (result.status === "complete") {
          await setSignUpActive({ session: result.createdSessionId });
        }
      }
    } catch (err: any) {
      console.error("Verification error:", err);
      setError(err.errors?.[0]?.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <PageLayout layout={layout}>
        <Container size="xs">
          <Box py="6xl">
            <Box pb="xl">
              <Text size="xl" weight="bold" align="center" mb="sm">
                Check your email
              </Text>
              <Text color="muted" align="center">
                We've sent a code to {email}
              </Text>
            </Box>

            <form onSubmit={handleVerifyCode}>
              <Box mb="lg">
                <Input
                  label="Verification code"
                  placeholder="Enter code"
                  name="code"
                  id="code-input"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  full
                  required
                />
              </Box>

              {error && (
                <Text color="destructive" size="sm" mb="md" align="center">
                  {error}
                </Text>
              )}

              <Button type="submit" full loading={loading}>
                Verify
              </Button>

              <Box mt="lg">
                <Button
                  variant="ghost"
                  full
                  onClick={() => setVerifying(false)}
                >
                  Back
                </Button>
              </Box>
            </form>
          </Box>
        </Container>
      </PageLayout>
    );
  }

  return (
    <PageLayout layout={layout}>
      <Container size="xs">
        <Box py="6xl">
          <Box pb="4xl">
            <Group justify="center">
              <RaizLogo />
            </Group>
          </Box>
          <Box pb="4xl">
            <Text size="xl" weight="bold" align="center" mb="sm">
              Welcome back
            </Text>
            <Text color="muted" align="center">
              Sign in or create an account to continue
            </Text>
          </Box>

          <Box mb="xl">
            <Button
              variant="secondary"
              full
              onClick={handleGoogleSignIn}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <GoogleLogo size={20} weight="bold" />
              Continue with Google
            </Button>
          </Box>

          <Box mb="xl" mt="xl">
            <Text size="xs" color="muted" align="center">
              -- or --
            </Text>
          </Box>

          <form onSubmit={handleEmailSubmit}>
            <Box mb="lg">
              <Input
                label="Email address"
                type="email"
                name="email"
                id="email-input"
                autoComplete="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                full
                required
              />
            </Box>

            {error && (
              <Text color="destructive" size="sm" mb="md" align="center">
                {error}
              </Text>
            )}

            <Button type="submit" full loading={loading}>
              Continue
            </Button>
          </form>
        </Box>
      </Container>
    </PageLayout>
  );
}
