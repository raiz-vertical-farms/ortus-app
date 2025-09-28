import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import DeviceCard from "../components/DeviceCard/DeviceCard";
import { client } from "../lib/apiClient";
import Box from "../primitives/Box/Box";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const router = useRouter();

  const { data } = client.api.allDevices.useQuery(undefined, {
    refetchInterval: 30000,
  });

  return (
    <Box pt="10">
      <Group
        style={{ viewTransitionName: "main-content" }}
        direction="column"
        align="center"
        spacing="5"
      >
        {data?.devices.map((device) => {
          return (
            <DeviceCard
              key={device.id}
              id={device.id}
              name={device.name}
              unique_id={device.unique_id}
              light_state={device.light_state}
              last_seen={device.last_seen}
            />
          );
        })}
        <Button
          size="lg"
          full
          onClick={() =>
            router.navigate({
              to: "/device/connect",
              viewTransition: { types: ["slide-down"] },
            })
          }
        >
          Connect to new Ortus
        </Button>
      </Group>
    </Box>
  );
}
