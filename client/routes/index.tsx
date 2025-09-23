import { createFileRoute } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <Container
      style={{ height: "100vh", display: "grid", placeItems: "center" }}
    >
      <Group direction="column" align="center" spacing="10">
        <Text size="2xl" align="center">
          You have no Ortus connected yet
        </Text>
        <Button>Connect Ortus</Button>
      </Group>
    </Container>
  );
}
