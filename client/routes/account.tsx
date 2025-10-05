import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import Box from "../primitives/Box/Box";
import PageLayout from "../layout/PageLayout/PageLayout";

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
    <PageLayout layout={{ pageTitle: "Account settings" }}>
      <Box pt="xl">
        <Group direction="column" align="center" spacing="xl">
          <Text align="center" color="muted">
            Want to switch gardeners? Sign out below.
          </Text>
          <Button onClick={handleLogout}>Sign out</Button>
        </Group>
      </Box>
    </PageLayout>
  );
}
