import { createFileRoute, useRouter } from "@tanstack/react-router";
import Container from "../../primitives/Container/Container";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import { Text } from "../../primitives/Text/Text";
import BluetoothDeviceCard from "../../components/BluetoothDeviceCard/BluetoothDeviceCard";
import Input from "../../primitives/Input/Input";
import { useState } from "react";
import { provisionDevice } from "../../utils/bluetooth";
import { useBluetooth } from "../../hooks/useBluetooth";
import { match } from "ts-pattern";

export const Route = createFileRoute("/device/connect")({
  component: Page,
});

function Page() {
  const router = useRouter();

  const [deviceId, setDeviceId] = useState("");
  const [view, setView] = useState<"main" | "provision">("main");

  const { isSupported } = useBluetooth();

  return match({ view, isSupported })
    .with({ view: "main", isSupported: false }, () => (
      <Text>Here we should have wifi provisioning option.</Text>
    ))
    .with({ view: "main", isSupported: true }, () => (
      <FindDevice
        onDeviceSelected={(deviceId) => {
          setDeviceId(deviceId);
          setView("provision");
        }}
      />
    ))
    .with({ view: "provision" }, () => (
      <ProvisionDevice
        deviceId={deviceId}
        onSuccess={() => {
          setView("main");
          router.navigate({ to: "/" });
        }}
      />
    ))
    .exhaustive();
}

function FindDevice({
  onDeviceSelected,
}: {
  onDeviceSelected: (deviceId: string) => void;
}) {
  const { isSupported, devices, startScan } = useBluetooth();

  return (
    <>
      {devices.length > 0 && (
        <Group direction="column" align="center" spacing="5">
          <h2>Discovered Devices</h2>

          {devices.map((device) => (
            <BluetoothDeviceCard
              key={device.device.deviceId}
              result={device}
              onClick={() => {
                onDeviceSelected(device.device.deviceId);
              }}
            />
          ))}
        </Group>
      )}
      {isSupported ? (
        <Button onClick={() => startScan()}>Scan for devices</Button>
      ) : (
        <Text>Bluetooth is not supported on this device.</Text>
      )}
    </>
  );
}

function ProvisionDevice({
  onSuccess,
  deviceId,
}: {
  onSuccess: () => void;
  deviceId: string;
}) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Group direction="column" spacing="5">
      <Input
        full
        onChange={(e) => setSsid(e.target.value)}
        value={ssid}
        label="WiFi SSID"
        placeholder="MyWiFiNetwork"
      />
      <Input
        full
        type="password"
        onChange={(e) => setPassword(e.target.value)}
        value={password}
        label="WiFi Password"
        placeholder="••••••••"
      />
      <Button
        full
        onClick={async () => {
          try {
            await provisionDevice(deviceId, ssid, password);
            onSuccess();
          } catch (error) {
            console.error("Provisioning failed:", error);
          }
        }}
      >
        Connect Ortus to WiFi
      </Button>
    </Group>
  );
}

function Success() {
  const router = useRouter();

  return (
    <Group>
      <Text>Device successfully provisioned!</Text>
      <Button onClick={() => router.navigate({ to: "/" })}>Done</Button>
    </Group>
  );
}
