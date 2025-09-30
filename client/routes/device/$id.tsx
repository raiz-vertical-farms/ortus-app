import { createFileRoute } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import { useState } from "react";
import { match } from "ts-pattern";
import { Group } from "../../primitives/Group/Group";
import Tabs from "../../primitives/Tabs/Tabs";
import { LightbulbFilamentIcon } from "@phosphor-icons/react";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const device = await client.api.deviceState({
      parameters: { path: { id: params.id } },
    });

    return {
      layout: {
        pageTitle: device.data?.state.name || "Device",
        backButton: true,
      },
    };
  },
});

function RouteComponent() {
  const { id } = Route.useParams();

  const [view, setView] = useState<"control" | "plants">("control");

  const { data, error, isLoading } = client.api.deviceState.useQuery({
    path: { id },
  });

  if (isLoading || !data) {
    return "Loading...";
  }

  if (error) {
    return getErrorMessage(error);
  }

  return (
    <Box pt="xl">
      <Group spacing="xl" justify="center">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "control", label: "Control" },
            { value: "plants", label: "Plants" },
          ]}
        />
      </Group>
      {match(view)
        .with("control", () => <ControlView deviceId={id} />)
        .with("plants", () => <Text>Plants view coming soon!</Text>)
        .exhaustive()}
    </Box>
  );
}

function ControlView({ deviceId }: { deviceId: string }) {
  const { data, error, isLoading, refetch } = client.api.deviceState.useQuery({
    path: { id: deviceId },
  });

  const { mutate: toggleLeftLight } = client.api.toggleLight.useMutation(
    undefined,
    { onSuccess: () => refetch() }
  );

  return (
    <>
      <Text>Light</Text>
      <Tabs
        value={data?.state.light ? "on" : "off"}
        onChange={(value) => {
          toggleLeftLight({ path: { id: deviceId }, body: { state: value } });
        }}
        options={[
          {
            value: "on",
            label: (
              <div>
                ON <LightbulbFilamentIcon />
              </div>
            ),
          },
          { value: "off", label: "OFF" },
        ]}
      />
    </>
  );
}
