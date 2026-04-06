import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import { client } from "../../lib/apiClient";
import { useState } from "react";
import Button from "../../primitives/Button/Button";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import PageLayout from "../../layout/PageLayout/PageLayout";
import Modal from "../../primitives/Modal/Modal";
import ProvisionFlow from "../../components/ProvisionFlow/ProvisionFlow";
import { useDevice, computePhase } from "../../hooks/useDevice";
import { classNames } from "../../utils/classnames";
import { Drop } from "@phosphor-icons/react";
import styles from "./$id.module.css";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
});

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RouteComponent() {
  const { id } = Route.useParams();
  const device = useDevice(id);

  if (device.isLoading || device.state === null) {
    return "Loading your garden...";
  }

  if (device.error) {
    return getErrorMessage(device.error);
  }

  const state = device.state;

  return (
    <PageLayout layout={{ pageTitle: state.name, backButton: true }}>
      <div className={styles.layout}>
        {state.water_empty && <WaterEmptyCard />}
        <LightCard deviceId={id} device={device} />
        <IrrigationCard deviceId={id} device={device} />
        <div className={styles.halfGrid}>
          <TemperatureCard temperature={state.temperature} />
          <SettingsCard deviceId={id} macAddress={state.mac_address!} />
        </div>
      </div>
    </PageLayout>
  );
}

// --- Light Card ---

function LightCard({
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const debouncedSetLight = useDebouncedCallback(
    (brightness: number) => {
      device
        .setBrightness(brightness)
        .catch((err) => console.error("Failed to set brightness", err));
    },
    device.isWebSocketConnected ? 0 : 1000,
  );

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setPendingBrightness(value);
    debouncedSetLight(value);
  };

  const schedule = device.state?.light_schedule;
  const currentBrightness = pendingBrightness ?? device.state?.brightness ?? 0;
  const phaseInfo = schedule?.active ? computePhase(schedule) : null;

  const hasSchedule = schedule != null;
  const isPaused = hasSchedule && !schedule.active;
  const isActive = hasSchedule && schedule.active;

  const statusText = (() => {
    if (!hasSchedule) return "No light schedule";
    if (isPaused) return "Light schedule paused";
    if (phaseInfo?.isOn)
      return `Lights are on, will turn off at ${formatTime(phaseInfo.phaseEndsAt)}`;
    if (phaseInfo)
      return `Lights are off, will turn on at ${formatTime(phaseInfo.phaseEndsAt)}`;
    return "Light schedule active";
  })();

  const handlePause = async () => {
    setLoading(true);
    try {
      await device.pauseLightSchedule();
    } finally {
      setLoading(false);
    }
  };

  const handleResumeOrStart = async () => {
    setLoading(true);
    try {
      await device.startLightSchedule();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={classNames(styles.cardContent, isPaused && styles.faded)}>
        <Text variant="heading" size="lg" mb="md">
          {statusText}
        </Text>
        <input
          type="range"
          min={0}
          max={100}
          value={currentBrightness}
          onChange={handleBrightnessChange}
          className={styles.slider}
        />
      </div>
      {isActive && (
        <Button onClick={handlePause} loading={loading}>
          Pause
        </Button>
      )}
      {(isPaused || !hasSchedule) && (
        <Button onClick={handleResumeOrStart} loading={loading}>
          {isPaused ? "Resume" : "Start schedule"}
        </Button>
      )}
    </div>
  );
}

// --- Irrigation Card ---

function IrrigationCard({
  device,
}: {
  deviceId: string;
  device: ReturnType<typeof useDevice>;
}) {
  const [loading, setLoading] = useState(false);

  const schedule = device.state?.irrigation_schedule;
  const phaseInfo = schedule?.active ? computePhase(schedule) : null;

  const hasSchedule = schedule != null;
  const isPaused = hasSchedule && !schedule.active;
  const isActive = hasSchedule && schedule.active;

  const statusText = (() => {
    if (!hasSchedule) return "No irrigation schedule";
    if (isPaused) return "Irrigation paused";
    if (phaseInfo?.isOn)
      return `Irrigation is running, watering until ${formatTime(phaseInfo.phaseEndsAt)}`;
    if (phaseInfo) return `Next watering at ${formatTime(phaseInfo.phaseEndsAt)}`;
    return "Irrigation schedule active";
  })();

  const handlePause = async () => {
    setLoading(true);
    try {
      await device.pauseIrrigationSchedule();
    } finally {
      setLoading(false);
    }
  };

  const handleResumeOrStart = async () => {
    setLoading(true);
    try {
      await device.startIrrigationSchedule();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={classNames(styles.cardContent, isPaused && styles.faded)}>
        <Text variant="heading" size="lg" mb="md">
          {statusText}
        </Text>
      </div>
      {isActive && (
        <Button onClick={handlePause} loading={loading}>
          Pause
        </Button>
      )}
      {(isPaused || !hasSchedule) && (
        <Button onClick={handleResumeOrStart} loading={loading}>
          {isPaused ? "Resume" : "Start schedule"}
        </Button>
      )}
    </div>
  );
}

// --- Water Empty Card ---

function WaterEmptyCard() {
  return (
    <div className={classNames(styles.card, styles.waterEmptyCard)}>
      <Drop size={32} weight="fill" />
      <Text variant="heading" size="lg">
        Water tank is empty
      </Text>
    </div>
  );
}

// --- Temperature Card ---

function TemperatureCard({ temperature }: { temperature: number | null }) {
  return (
    <div className={classNames(styles.card, styles.temperatureCard)}>
      <Text variant="heading" size="4xl">
        {temperature != null ? `${Math.round(temperature)}°` : "—"}
      </Text>
      <Text color="muted" size="sm">
        temperature
      </Text>
    </div>
  );
}

// --- Settings Card ---

function SettingsCard({
  deviceId,
  macAddress,
}: {
  deviceId: string;
  macAddress: string;
}) {
  const router = useRouter();
  const [showSettings, setShowSettings] = useState(false);
  const { mutate } = client.api.deleteDevice.useMutation(undefined, {
    onSuccess: () => {
      router.navigate({ to: "/" });
    },
  });

  return (
    <>
      <div
        className={classNames(styles.card, styles.settingsCard)}
        onClick={() => setShowSettings(true)}
      >
        <GearIcon />
        <Text color="muted" size="sm">
          settings
        </Text>
      </div>
      <Modal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="Settings"
      >
        <Button
          variant="destructive"
          onClick={() => mutate({ path: { id: deviceId } })}
        >
          Remove this Ortus
        </Button>
        <ProvisionFlow onProvisionSucceeded={() => setShowSettings(false)} />
      </Modal>
    </>
  );
}

function GearIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.gearIcon}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
