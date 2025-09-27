import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { useQuery } from "../hooks/useQuery";
import { apiClient } from "../lib/hono-client";
import DeviceCard from "../components/DeviceCard/DeviceCard";

export const Route = createFileRoute("/")({
  component: Index,
  staticData: {
    layout: {
      center: true,
    },
  },
});

function Index() {
  const router = useRouter();

  const { data } = useQuery(
    apiClient.device.devices.$get,
    {},
    { pollInterval: 3000 }
  );

  return (
    <Group direction="column" align="center" spacing="5">
      {data?.devices.map((device) => {
        if (!device.id) return null;

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
        onClick={() => router.navigate({ to: "/device/connect" })}
      >
        Connect to new Ortus
      </Button>
    </Group>
  );
}
