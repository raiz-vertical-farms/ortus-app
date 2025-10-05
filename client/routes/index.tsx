import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import DeviceCard from "../components/DeviceCard/DeviceCard";
import { client } from "../lib/apiClient";
import Box from "../primitives/Box/Box";
import { Text } from "../primitives/Text/Text";
import { PlusCircleIcon } from "@phosphor-icons/react";
import PageLayout from "../layout/PageLayout/PageLayout";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const router = useRouter();

  const { data: connectedDevices } = client.api.allDevices.useQuery(undefined, {
    refetchInterval: 5000,
  });

  return (
    <PageLayout
      layout={{
        pageTitle: "My Garden",
        rightSection: () => (
          <Button
            variant="ghost"
            square
            onClick={() =>
              router.navigate({
                to: "/device/connect",
                viewTransition: { types: ["pop-up"] },
              })
            }
          >
            <PlusCircleIcon
              fill="currentColor"
              size={32}
              style={{ marginLeft: 8 }}
            />
          </Button>
        ),
      }}
    >
      <Box pt="6xl">
        <Group direction="column" align="center" spacing="lg">
          {connectedDevices?.devices.length === 0 && (
            <Group direction="column" align="center" spacing="md">
              <Text align="center" size="lg">
                No Ortus connected yet.
              </Text>
              <Button
                size="sm"
                onClick={() => router.navigate({ to: "/device/connect" })}
              >
                Add an Ortus
              </Button>
            </Group>
          )}
          {connectedDevices?.devices.length ? (
            <Text align="center" color="muted">
              Tap an Ortus to check on it.
            </Text>
          ) : null}
          {connectedDevices?.devices.map((device) => {
            return (
              <DeviceCard
                key={device.id}
                id={device.id}
                name={device.name}
                mac_address={device.mac_address}
                last_seen={device.last_seen}
                online={device.online}
              />
            );
          })}
        </Group>
      </Box>
    </PageLayout>
  );
}
