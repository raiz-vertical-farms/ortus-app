import { useRouter, createFileRoute } from "@tanstack/react-router";
import Input from "../primitives/Input/Input";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { Text } from "../primitives/Text/Text";
import Box from "../primitives/Box/Box";
import { useState } from "react";
import { client } from "../lib/apiClient";
import { getErrorMessage } from "../utils/error";

export const Route = createFileRoute("/signup")({
  component: Signup,
  staticData: { layout: { hideNav: true } },
});

function Signup() {
  const router = useRouter();

  const [formState, setFormState] = useState({ email: "", password: "" });

  const {
    mutate: signup,
    isPending: isSigningUp,
    error: signupError,
  } = client.api.signup.useMutation(
    {},
    {
      onSuccess: (res) => {
        localStorage.setItem("token", res.jwt);
        setTimeout(() => {
          router.navigate({ to: "/" });
        }, 100);
      },
    }
  );

  return (
    <div style={{ height: "100dvh", display: "grid", placeItems: "center" }}>
      <Group direction="column" spacing="xl">
        <Box style={{ width: "100%" }} pb="xl">
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

        <Button size="lg" onClick={() => signup({ ...formState })} full>
          Log In
        </Button>

        {signupError ? (
          <Text align="center">{getErrorMessage(signupError)}</Text>
        ) : null}
      </Group>
    </div>
  );
}
