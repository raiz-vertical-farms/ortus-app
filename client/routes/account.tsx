import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import Box from "../primitives/Box/Box";

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
    <Box pt="10">
      <Group
        style={{ viewTransitionName: "main-content" }}
        direction="column"
        align="center"
        spacing="10"
      >
        <Text size="2xl" align="center">
          Account page
        </Text>
        <Button onClick={handleLogout}>Logout</Button>
      </Group>
    </Box>
  );
}
