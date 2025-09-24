import { createFileRoute } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { useMutation } from "../hooks";
import { apiClient } from "../lib/hono-client";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { mutate } = useMutation(
    apiClient.device[":id"].light[":lightId"].$post
  );

  return (
    <Container
      style={{ height: "100vh", display: "grid", placeItems: "center" }}
    >
      <Group direction="column" align="center" spacing="10">
        <Text size="2xl" align="center">
          You have no Ortus connected yet
        </Text>
        <Button
          onClick={() =>
            mutate({
              param: { id: "123", lightId: "123" },
              json: { state: "ON" },
            })
          }
        >
          Connect Ortus
        </Button>
      </Group>
    </Container>
  );
}
