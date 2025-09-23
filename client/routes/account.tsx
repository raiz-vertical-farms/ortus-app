import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";

export const Route = createFileRoute("/account")({
  component: Page,
});

function Page() {
  const router = useRouter();

  function handleLogout() {
    localStorage.removeItem("token");
    router.navigate({ to: "/signup" });
  }

  return (
    <Container
      style={{ height: "100vh", display: "grid", placeItems: "center" }}
    >
      <Group direction="column" align="center" spacing="10">
        <Text size="2xl" align="center">
          Account page
        </Text>
        <Button onClick={handleLogout}>Logout</Button>
      </Group>
    </Container>
  );
}
