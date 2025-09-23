import { hc } from "hono/client";
import type { AppType } from "../../server/index";
import { useMutation } from "../hooks/index";
import { useRouter, createFileRoute } from "@tanstack/react-router";
import Input from "../primitives/Input/Input";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { Text } from "../primitives/Text/Text";
import Box from "../primitives/Box/Box";
import { useState } from "react";

const client = hc<AppType>(process.env.BACKEND_URL || "http://localhost:3000");

export const Route = createFileRoute("/signup")({
  component: Signup,
});

function Signup() {
  const router = useRouter();

  const [formState, setFormState] = useState({ email: "", password: "" });

  const {
    mutate: login,
    loading: isLoggingIn,
    error: loginError,
  } = useMutation(client.api.login.$post);

  const {
    mutate: signup,
    loading: isSigningUp,
    error: signupError,
  } = useMutation(client.api.signup.$post);

  function handleSignup() {
    signup(formState).then((res) => {
      if ("jwt" in res) {
        localStorage.setItem("token", res.jwt);
        router.navigate({ to: "/" });
      } else {
        console.error("Signup failed:", res);
      }
    });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <Container>
        <Group direction="column" spacing="5">
          <Box style={{ width: "100%" }} pb="10">
            <Text size="4xl" align="center" color="strong">
              Raiz.
            </Text>
            <Text size="xl" align="center" color="muted">
              Get growing
            </Text>
          </Box>

          <Input
            label="Email"
            type="email"
            full
            onChange={(e) =>
              setFormState((s) => ({ ...s, email: e.target.value }))
            }
            value={formState.email}
            placeholder=""
            inputSize="lg"
          />

          <Input
            label="Password"
            type="password"
            full
            onChange={(e) =>
              setFormState((s) => ({ ...s, password: e.target.value }))
            }
            value={formState.password}
            placeholder=""
            inputSize="lg"
          />

          <Button onClick={handleSignup} full>
            Log In
          </Button>
        </Group>
      </Container>
    </div>
  );
}
