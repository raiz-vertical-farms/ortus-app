import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import Box from "../primitives/Box/Box";

export const Route = createFileRoute("/account")({
  component: Page,
  staticData: {
    layout: {
      pageTitle: "Account",
    },
  },
});

function Page() {
  const router = useRouter();

  function handleLogout() {
    localStorage.removeItem("token");
    router.navigate({ to: "/signup" });
  }

  return (
    <Box pt="xl">
      <Group direction="column" align="center" spacing="xl">
        <Button onClick={handleLogout}>Logout</Button>
      </Group>
    </Box>
  );
}
