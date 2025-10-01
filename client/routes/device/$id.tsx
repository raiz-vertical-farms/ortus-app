import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import { useState } from "react";
import { match } from "ts-pattern";
import { Group } from "../../primitives/Group/Group";
import Tabs from "../../primitives/Tabs/Tabs";
import { LightbulbFilamentIcon } from "@phosphor-icons/react";
import Toggle from "../../primitives/Toggle/Toggle";
import Input from "../../primitives/Input/Input";
import Button from "../../primitives/Button/Button";

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

  const [view, setView] = useState<"lights" | "plants" | "water" | "settings">(
    "lights"
  );

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
            { value: "lights", label: "Lights" },
            { value: "water", label: "Water" },
            { value: "plants", label: "Plants" },
            { value: "settings", label: "Settings" },
          ]}
        />
      </Group>
      {match(view)
        .with("lights", () => <LightView deviceId={id} />)
        .with("plants", () => <Text>Plants view coming soon!</Text>)
        .with("water", () => <Text>Water view coming soon!</Text>)
        .with("settings", () => <SettingsView deviceId={id} />)
        .exhaustive()}
    </Box>
  );
}

function SettingsView({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const { mutate } = client.api.deleteDevice.useMutation(undefined, {
    onSuccess: () => {
      router.navigate({ to: "/" });
    },
  });

  return (
    <Box pt="5xl">
      <Text>Danger zone</Text>
      <Button onClick={() => mutate({ path: { id: deviceId } })}>
        Delete device
      </Button>
    </Box>
  );
}

function LightView({ deviceId }: { deviceId: string }) {
  const [scheduleState, setScheduleState] = useState<{
    fromHours: number;
    fromMinutes: number;
    toHours: number;
    toMinutes: number;
  }>({ fromHours: 0, fromMinutes: 0, toHours: 0, toMinutes: 0 });

  const { data, error, isLoading, refetch } = client.api.deviceState.useQuery({
    path: { id: deviceId },
  });

  const { mutate: toggleLeftLight } = client.api.toggleLight.useMutation(
    undefined,
    { onSuccess: () => refetch() }
  );

  const { mutate: scheduleLights } = client.api.scheduleLight.useMutation(
    undefined,
    { onSuccess: () => refetch() }
  );

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <LightbulbFilamentIcon
          color={data?.state.light === "on" ? "#f8c824" : "#616161ff"}
          size={200}
        />
        <Toggle
          onLabel="On"
          color="#f8c824"
          offLabel="Off"
          checked={data?.state.light === "on"}
          onChange={(event) => {
            toggleLeftLight({
              path: { id: deviceId },
              body: { state: event ? "on" : "off" },
            });
          }}
        />
      </Group>
      <Box pt="5xl">
        <Group direction="column" align="center" justify="center" spacing="xl">
          <Text align="center" size="lg">
            Schedule
          </Text>
          <Group direction="row" align="center" justify="center" spacing="xl">
            <Text align="left" size="lg">
              From
            </Text>
            <select
              onChange={(e) =>
                setScheduleState({
                  ...scheduleState,
                  fromHours: parseInt(e.target.value),
                })
              }
            >
              {new Array(23).fill(null).map((_, i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <select
              onChange={(e) =>
                setScheduleState({
                  ...scheduleState,
                  fromMinutes: parseInt(e.target.value),
                })
              }
            >
              <option>00</option>
              <option>15</option>
              <option>30</option>
              <option>45</option>
            </select>
          </Group>
          <Group direction="row" align="center" justify="center" spacing="xl">
            <Text align="left" size="lg">
              To
            </Text>
            <select
              onChange={(e) =>
                setScheduleState({
                  ...scheduleState,
                  toHours: parseInt(e.target.value),
                })
              }
            >
              {new Array(23).fill(null).map((_, i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <select
              onChange={(e) =>
                setScheduleState({
                  ...scheduleState,
                  toMinutes: parseInt(e.target.value),
                })
              }
            >
              <option>00</option>
              <option>15</option>
              <option>30</option>
              <option>45</option>
            </select>
            <Button
              onClick={() => {
                scheduleLights({
                  path: { id: deviceId },
                  body: {
                    from_hour: scheduleState.fromHours,
                    from_minute: scheduleState.fromMinutes,
                    to_hour: scheduleState.toHours,
                    to_minute: scheduleState.toMinutes,
                  },
                });
              }}
            >
              Schedule
            </Button>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}
