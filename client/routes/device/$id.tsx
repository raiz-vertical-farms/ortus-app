import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import { useState } from "react";
import { match } from "ts-pattern";
import { Group } from "../../primitives/Group/Group";
import Tabs from "../../primitives/Tabs/Tabs";
import Button from "../../primitives/Button/Button";
import LightSwitch from "../../components/LightSwitch/LightSwitch";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import PageLayout from "../../layout/PageLayout/PageLayout";
import Modal from "../../primitives/Modal/Modal";
import ProvisionFlow from "../../components/ProvisionFlow/ProvisionFlow";
import {
  useDevice,
  computePhase,
  type IntervalSchedule,
} from "../../hooks/useDevice";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();
  const [view, setView] = useState<
    "lights" | "temperature" | "water" | "fan" | "settings"
  >("lights");
  const device = useDevice(id);

  if (device.isLoading || device.state === null) {
    return "Loading your garden...";
  }

  if (device.error) {
    return getErrorMessage(device.error);
  }

  const state = device.state;

  console.log("Device state:", state, "View:", view);

  return (
    <PageLayout layout={{ pageTitle: state.name, backButton: true }}>
      <Box pt="xl">
        <Group spacing="xl" justify="center">
          <Tabs
            value={state.online ? view : "settings"}
            onChange={setView}
            options={[
              { value: "lights", label: "Lights", disabled: false },
              { value: "water", label: "Water", disabled: false },
              { value: "fan", label: "Fan", disabled: false },
              { value: "temperature", label: "Temperature", disabled: false },
              { value: "settings", label: "Settings" },
            ]}
          />
        </Group>
        {match({ view })
          .with({ view: "lights" }, () => (
            <LightView deviceId={id} device={device} />
          ))
          .with({ view: "temperature" }, () => (
            <Text>Temperature: {device.state?.temperature}°C</Text>
          ))
          .with({ view: "water" }, () => (
            <WaterView deviceId={id} device={device} />
          ))
          .with({ view: "fan" }, () => (
            <FanView deviceId={id} device={device} />
          ))
          .with({ view: "settings" }, () => (
            <SettingsView macAddress={state.mac_address!} deviceId={id} />
          ))
          .exhaustive()}
      </Box>
    </PageLayout>
  );
}

// --- Shared helpers ---

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmModal({
  open,
  title,
  description,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <Group direction="column" spacing="xl">
        <Text>{description}</Text>
        <Group direction="row" spacing="xl">
          <Button onClick={onConfirm}>Confirm</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Group>
      </Group>
    </Modal>
  );
}

// --- Light View ---

function LightView({
  deviceId,
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    action: string;
    description: string;
    fn: () => Promise<void>;
  } | null>(null);

  const debouncedSetLight = useDebouncedCallback(
    (brightness: number) => {
      device
        .setBrightness(brightness)
        .catch((err) => console.error("Failed to set brightness", err));
    },
    device.isWebSocketConnected ? 0 : 1000,
  );

  const handleBrightnessChange = (value: number) => {
    setPendingBrightness(value);
    debouncedSetLight(value);
  };

  const schedule = device.state?.light_schedule;
  const currentBrightness = pendingBrightness ?? device.state?.brightness ?? 0;

  const phaseInfo = schedule?.active ? computePhase(schedule) : null;

  const statusText = (() => {
    if (!schedule?.active || !phaseInfo) return "Schedule off";
    return phaseInfo.isOn
      ? `Lights on until ${formatTime(phaseInfo.phaseEndsAt)}`
      : `Lights off until ${formatTime(phaseInfo.phaseEndsAt)}`;
  })();

  const skipLabel = (() => {
    if (!phaseInfo) return "Skip";
    const nextPhaseEnd =
      phaseInfo.phaseEndsAt +
      (phaseInfo.isOn ? schedule!.minutes_off : schedule!.minutes_on) *
        60 *
        1000;
    return phaseInfo.isOn
      ? `Skip: Lights will turn on again at ${formatTime(phaseInfo.phaseEndsAt + schedule!.minutes_off * 60 * 1000)}`
      : `Start now: Lights on until ${formatTime(Date.now() + schedule!.minutes_on * 60 * 1000)}`;
  })();

  function ask(action: string, description: string, fn: () => Promise<void>) {
    setConfirm({ action, description, fn });
  }

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
          <Text align="center">{statusText}</Text>

          {!schedule?.active ? (
            <Button
              onClick={() =>
                ask(
                  "Start schedule",
                  "Start the light cycle? Lights will follow the default 12h on / 12h off schedule.",
                  device.startLightSchedule,
                )
              }
            >
              Start schedule
            </Button>
          ) : (
            <>
              <Button
                onClick={() =>
                  ask(
                    "Pause schedule",
                    "Pause the light schedule?",
                    device.pauseLightSchedule,
                  )
                }
              >
                Pause schedule
              </Button>
              <Button
                onClick={() =>
                  ask("Skip phase", skipLabel, device.skipLightSchedule)
                }
              >
                {phaseInfo?.isOn ? "Skip current ON phase" : "Start now"}
              </Button>
            </>
          )}
        </Group>
      </Box>

      {confirm && (
        <ConfirmModal
          open
          title={confirm.action}
          description={confirm.description}
          onConfirm={async () => {
            await confirm.fn();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Box>
  );
}

// --- Water View ---

function WaterView({
  deviceId,
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [confirm, setConfirm] = useState<{
    action: string;
    description: string;
    fn: () => Promise<void>;
  } | null>(null);

  const schedule = device.state?.irrigation_schedule;
  const phaseInfo = schedule?.active ? computePhase(schedule) : null;

  const statusText = (() => {
    if (!schedule?.active || !phaseInfo) return "Schedule off";
    return phaseInfo.isOn
      ? `Watering until ${formatTime(phaseInfo.phaseEndsAt)}`
      : `Next watering at ${formatTime(phaseInfo.phaseEndsAt)}`;
  })();

  const skipLabel = (() => {
    if (!phaseInfo || !schedule) return "Skip";
    return phaseInfo.isOn
      ? `Skip: Next watering will happen at ${formatTime(phaseInfo.phaseEndsAt + schedule.minutes_off * 60 * 1000)}`
      : `Start now: Will water until ${formatTime(Date.now() + schedule.minutes_on * 60 * 1000)}`;
  })();

  function ask(action: string, description: string, fn: () => Promise<void>) {
    setConfirm({ action, description, fn });
  }

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <Text variant="heading" size="xl">
          Water level: {device.state?.water_level ?? "—"}
        </Text>

        <Text align="center" size="lg">
          Irrigation schedule
        </Text>
        <Text align="center">{statusText}</Text>

        {!schedule?.active ? (
          <Button
            onClick={() =>
              ask(
                "Start irrigation",
                "Start irrigation schedule? Will water on the default cycle.",
                device.startIrrigationSchedule,
              )
            }
          >
            Start schedule
          </Button>
        ) : (
          <>
            <Button
              onClick={() =>
                ask(
                  "Pause irrigation",
                  "Pause the irrigation schedule?",
                  device.pauseIrrigationSchedule,
                )
              }
            >
              Pause schedule
            </Button>
            <Button
              onClick={() =>
                ask("Skip phase", skipLabel, device.skipIrrigationSchedule)
              }
            >
              {phaseInfo?.isOn ? "Skip current watering" : "Water now"}
            </Button>
          </>
        )}
      </Group>

      {confirm && (
        <ConfirmModal
          open
          title={confirm.action}
          description={confirm.description}
          onConfirm={async () => {
            await confirm.fn();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Box>
  );
}

// --- Fan View ---

function FanView({
  deviceId,
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [confirm, setConfirm] = useState<{
    action: string;
    description: string;
    fn: () => Promise<void>;
  } | null>(null);

  const schedule = device.state?.fan_schedule;
  const phaseInfo = schedule?.active ? computePhase(schedule) : null;

  const statusText = (() => {
    if (!schedule?.active || !phaseInfo) return "Schedule off";
    return phaseInfo.isOn
      ? `Fan on until ${formatTime(phaseInfo.phaseEndsAt)}`
      : `Fan off until ${formatTime(phaseInfo.phaseEndsAt)}`;
  })();

  const skipLabel = (() => {
    if (!phaseInfo || !schedule) return "Skip";
    return phaseInfo.isOn
      ? `Skip: Fan will turn on again at ${formatTime(phaseInfo.phaseEndsAt + schedule.minutes_off * 60 * 1000)}`
      : `Start now: Fan on until ${formatTime(Date.now() + schedule.minutes_on * 60 * 1000)}`;
  })();

  function ask(action: string, description: string, fn: () => Promise<void>) {
    setConfirm({ action, description, fn });
  }

  return (
    <Box pt="5xl">
      <Group direction="column" align="center" justify="center" spacing="xl">
        <Text align="center" size="lg">
          Fan schedule
        </Text>
        <Text align="center">{statusText}</Text>

        {!schedule?.active ? (
          <Button
            onClick={() =>
              ask(
                "Start fan",
                "Start fan schedule? Fan will run on the default 30min on / 30min off cycle.",
                device.startFanSchedule,
              )
            }
          >
            Start schedule
          </Button>
        ) : (
          <>
            <Button
              onClick={() =>
                ask(
                  "Pause fan",
                  "Pause the fan schedule?",
                  device.pauseFanSchedule,
                )
              }
            >
              Pause schedule
            </Button>
            <Button
              onClick={() =>
                ask("Skip phase", skipLabel, device.skipFanSchedule)
              }
            >
              {phaseInfo?.isOn ? "Skip current ON phase" : "Turn on now"}
            </Button>
          </>
        )}
      </Group>

      {confirm && (
        <ConfirmModal
          open
          title={confirm.action}
          description={confirm.description}
          onConfirm={async () => {
            await confirm.fn();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Box>
  );
}

// --- Settings View ---

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
        <ProvisionFlow onProvisionSucceeded={() => setShowReconnect(false)} />
      </Modal>
    </>
  );
}
