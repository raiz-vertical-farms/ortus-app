import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import { useState } from "react";
import { match } from "ts-pattern";
import { Group } from "../../primitives/Group/Group";
import Tabs from "../../primitives/Tabs/Tabs";
import Toggle from "../../primitives/Toggle/Toggle";
import Button from "../../primitives/Button/Button";
import LightSwitch from "../../components/LightSwitch/LightSwitch";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import PageLayout from "../../layout/PageLayout/PageLayout";
import Modal from "../../primitives/Modal/Modal";
import ProvisionFlow from "../../components/ProvisionFlow/ProvisionFlow";
import { set } from "zod";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
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
    return "Loading your garden...";
  }

  if (error) {
    return getErrorMessage(error);
  }

  return (
    <PageLayout layout={{ pageTitle: data.state.name, backButton: true }}>
      <Box pt="xl">
        <Group spacing="xl" justify="center">
          <Tabs
            value={data.state.online ? view : "settings"}
            onChange={setView}
            options={[
              {
                value: "lights",
                label: "Lights",
                disabled: !data.state.online,
              },
              { value: "water", label: "Water", disabled: !data.state.online },
              {
                value: "plants",
                label: "Plants",
                disabled: !data.state.online,
              },
              { value: "settings", label: "Settings" },
            ]}
          />
        </Group>
        {match({
          view: data.state.online ? view : "settings",
          online: data.state.online ? true : false,
        })
          .with({ view: "lights" }, () => <LightView deviceId={id} />)
          .with({ view: "plants" }, () => (
            <Text>Plant view is sprouting soon.</Text>
          ))
          .with({ view: "water" }, () => (
            <Text>Water view is bubbling up soon.</Text>
          ))
          .with({ view: "settings" }, () => (
            <SettingsView macAddress={data.state.mac_address} deviceId={id} />
          ))
          .exhaustive()}
      </Box>
    </PageLayout>
  );
}

function SettingsView({
  deviceId,
  macAddress,
}: {
  deviceId: string;
  macAddress: string;
}) {
  const router = useRouter();
  const [showReconnect, setShowReconnect] = useState(false);
  const { mutate } = client.api.deleteDevice.useMutation(undefined, {
    onSuccess: () => {
      router.navigate({ to: "/" });
    },
  });

  return (
    <>
      <Box pt="5xl">
        <Text>Danger zone (careful!)</Text>
        <Button onClick={() => mutate({ path: { id: deviceId } })}>
          Remove this Ortus
        </Button>
        <Text>Reconnect to a device</Text>
        <Button onClick={() => setShowReconnect(true)}>
          Reconnect to device
        </Button>
      </Box>
      <Modal
        open={showReconnect}
        onClose={() => setShowReconnect(false)}
        title="Reconnect to Ortus"
      >
        <ProvisionFlow
          onProvisionSucceeded={(mac) => {
            setShowReconnect(false);
          }}
        />
      </Modal>
    </>
  );
}

function LightView({ deviceId }: { deviceId: string }) {
  const [scheduleState, setScheduleState] = useState<{
    fromHours: number;
    fromMinutes: number;
    toHours: number;
    toMinutes: number;
  }>({ fromHours: 0, fromMinutes: 0, toHours: 0, toMinutes: 0 });

  const [showSchedule, setShowSchedule] = useState(false);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null
  );

  const { data, refetch } = client.api.deviceState.useQuery(
    {
      path: { id: deviceId },
    },
    { refetchInterval: 3000, staleTime: 0, enabled: pendingBrightness === null }
  );

  const debouncedRefetch = useDebouncedCallback(() => {
    refetch().then(() => {
      setPendingBrightness(null);
    });
  }, 8000);

  const { mutate: setLight } = client.api.setLight.useMutation(undefined, {
    onSuccess: debouncedRefetch,
  });

  const debouncedSetLight = useDebouncedCallback((brightness: number) => {
    setLight({
      path: { id: deviceId },
      body: { brightness },
    });
  }, 300);

  const { mutate: scheduleLights } = client.api.scheduleLight.useMutation(
    undefined,
    { onSuccess: () => refetch() }
  );

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <LightSwitch
          brightness={
            pendingBrightness !== null
              ? pendingBrightness
              : data?.state.light || 0
          }
          onChange={(val) => {
            setPendingBrightness(val);
            debouncedSetLight(val);
          }}
        />
      </Group>
      <Box pt="5xl">
        <Group direction="column" align="center" justify="center" spacing="xl">
          <Text align="center" size="lg">
            Light schedule
          </Text>
          <Toggle
            onLabel="Schedule on"
            offLabel="Manual control"
            checked={showSchedule}
            onChange={(e) => setShowSchedule(e.target.checked)}
          />
          {showSchedule && (
            <>
              <Group
                direction="row"
                align="center"
                justify="center"
                spacing="xl"
              >
                <Text align="left" size="lg">
                  Lights on
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
              <Group
                direction="row"
                align="center"
                justify="center"
                spacing="xl"
              >
                <Text align="left" size="lg">
                  Lights off
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
                  Save schedule
                </Button>
              </Group>
            </>
          )}
        </Group>
      </Box>
    </Box>
  );
}
