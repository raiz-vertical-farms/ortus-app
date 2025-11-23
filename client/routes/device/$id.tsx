import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import { useEffect, useState } from "react";
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
import { useDevice } from "../../hooks/useDevice";
import { getHoursAndMinutesByTimestamp } from "../../utils/time";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();

  const [view, setView] = useState<
    "lights" | "temperature" | "water" | "settings"
  >("lights");

  const device = useDevice(id);

  if (device.isLoading || device.state === null) {
    return "Loading your garden...";
  }

  const state = device.state;

  if (state === null) {
    return "Device not found";
  }

  if (device.error) {
    return getErrorMessage(device.error);
  }

  return (
    <PageLayout layout={{ pageTitle: state.name, backButton: true }}>
      <Box pt="xl">
        <Group spacing="xl" justify="center">
          <Tabs
            value={state.online ? view : "settings"}
            onChange={setView}
            options={[
              {
                value: "lights",
                label: "Lights",
                disabled: !state.online,
              },
              {
                value: "water",
                label: "Water",
                disabled: !state.online,
              },
              {
                value: "temperature",
                label: "Temperature",
                disabled: !state.online,
              },
              { value: "settings", label: "Settings" },
            ]}
          />
        </Group>
        {match({
          view: state.online ? view : "settings",
          online: state.online ? true : false,
        })
          .with({ view: "lights" }, () => (
            <LightView deviceId={id} device={device} />
          ))
          .with({ view: "temperature" }, () => (
            <Text>Temperature level {device.state?.temperature} .</Text>
          ))
          .with({ view: "water" }, () => (
            <WaterView deviceId={id} device={device} />
          ))
          .with({ view: "settings" }, () => (
            <SettingsView macAddress={state.mac_address!} deviceId={id} />
          ))
          .exhaustive()}
      </Box>
    </PageLayout>
  );
}

function WaterView({
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const scheduleActive = device.state?.pump_schedule?.active ?? false;

  const { hours: startHours, minutes: startMinutes } =
    getHoursAndMinutesByTimestamp(device.state?.pump_schedule?.start_time ?? 0);

  const timesPerDay = Math.max(
    1,
    device.state?.pump_schedule?.times_per_day ?? 1
  );

  const scheduleState = { startHours, startMinutes, timesPerDay };

  const minuteOptions = ["00", "15", "24", "30", "45"];
  const timesPerDayOptions = [1, 2, 3, 4, 6, 8, 12];

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <Text variant="heading" size="xl">
          Water level: {device.state?.water_level}
        </Text>

        <Text align="center" size="lg">
          Pump schedule
        </Text>
        <Toggle
          onLabel="Schedule on"
          offLabel="Manual control"
          checked={scheduleActive}
          onChange={(e) => {
            const enabled = e.target.checked;
            if (enabled) {
              device.schedulePump(scheduleState);
            } else {
              device.togglePumpSchedule(false);
            }
          }}
        />
        {scheduleActive && (
          <>
            <Group direction="row" align="center" justify="center" spacing="xl">
              <Text align="left" size="lg">
                First watering
              </Text>
              <select
                onChange={(e) =>
                  device.schedulePump({
                    ...scheduleState,
                    startHours: parseInt(e.target.value, 10),
                  })
                }
                value={scheduleState.startHours}
              >
                {new Array(24).fill(null).map((_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <select
                onChange={(e) =>
                  device.schedulePump({
                    ...scheduleState,
                    startMinutes: parseInt(e.target.value, 10),
                  })
                }
                value={scheduleState.startMinutes}
              >
                {minuteOptions.map((label) => (
                  <option key={label} value={parseInt(label, 10)}>
                    {label}
                  </option>
                ))}
              </select>
            </Group>
            <Group direction="row" align="center" justify="center" spacing="xl">
              <Text align="left" size="lg">
                Times per day
              </Text>
              <select
                onChange={(e) =>
                  device.schedulePump({
                    ...scheduleState,
                    timesPerDay: parseInt(e.target.value, 10),
                  })
                }
                value={scheduleState.timesPerDay}
              >
                {timesPerDayOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Group>
          </>
        )}
      </Group>
    </Box>
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

type ScheduleState = {
  fromHours: number;
  fromMinutes: number;
  toHours: number;
  toMinutes: number;
};

function LightView({
  deviceId,
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (pendingBrightness === null) {
      return;
    }

    if (device.state && device.state.brightness === pendingBrightness) {
      const timeout = setTimeout(() => setPendingBrightness(null), 150);
      return () => clearTimeout(timeout);
    }
  }, [pendingBrightness, device.state?.brightness]);

  const debouncedSetLight = useDebouncedCallback(
    (brightness: number) => {
      device
        .setBrightness(brightness)
        .catch((error) => console.error("Failed to set brightness", error));
    },
    device.isWebSocketConnected ? 0 : 1000
  );

  const handleBrightnessChange = (value: number) => {
    setPendingBrightness(value);
    debouncedSetLight(value);
  };

  const currentBrightness = pendingBrightness ?? device.state?.brightness ?? 0;
  const scheduleActive = device.state?.light_schedule?.active ?? false;

  const { hours: fromHours, minutes: fromMinutes } =
    getHoursAndMinutesByTimestamp(device.state?.light_schedule?.on ?? 0);

  const { hours: toHours, minutes: toMinutes } = getHoursAndMinutesByTimestamp(
    device.state?.light_schedule?.off ?? 0
  );

  const scheduleState = { fromHours, fromMinutes, toHours, toMinutes };

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <LightSwitch
          brightness={currentBrightness}
          onChange={handleBrightnessChange}
        />
        <Text size="sm">
          {device.isWebSocketConnected
            ? "LAN control active"
            : "Using cloud fallback"}
        </Text>
      </Group>
      <Box pt="5xl">
        <Group direction="column" align="center" justify="center" spacing="xl">
          <Text align="center" size="lg">
            Light schedule
          </Text>
          <Toggle
            onLabel="Schedule on"
            offLabel="Manual control"
            checked={scheduleActive}
            onChange={(e) => device.toggleLightSchedule(e.target.checked)}
          />
          {scheduleActive && (
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
                    device.scheduleLights({
                      ...scheduleState,
                      fromHours: parseInt(e.target.value),
                    })
                  }
                  value={scheduleState.fromHours}
                >
                  {new Array(24).fill(null).map((_, i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
                <select
                  onChange={(e) =>
                    device.scheduleLights({
                      ...scheduleState,
                      fromMinutes: parseInt(e.target.value),
                    })
                  }
                  value={scheduleState.fromMinutes}
                >
                  {["00", "15", "30", "45"].map((label) => (
                    <option key={label} value={parseInt(label)}>
                      {label}
                    </option>
                  ))}
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
                    device.scheduleLights({
                      ...scheduleState,
                      toHours: parseInt(e.target.value),
                    })
                  }
                  value={scheduleState.toHours}
                >
                  {new Array(24).fill(null).map((_, i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
                <select
                  onChange={(e) =>
                    device.scheduleLights({
                      ...scheduleState,
                      toMinutes: parseInt(e.target.value),
                    })
                  }
                  value={scheduleState.toMinutes}
                >
                  {["00", "15", "30", "36", "45"].map((label) => (
                    <option key={label} value={parseInt(label)}>
                      {label}
                    </option>
                  ))}
                </select>
              </Group>
            </>
          )}
        </Group>
      </Box>
    </Box>
  );
}
