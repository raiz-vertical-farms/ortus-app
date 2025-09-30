import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import { Text } from "../../primitives/Text/Text";
import BluetoothDeviceCard from "../../components/BluetoothDeviceCard/BluetoothDeviceCard";
import Input from "../../primitives/Input/Input";
import { useState } from "react";
import { provisionDevice } from "../../utils/bluetooth";
import { useBluetooth } from "../../hooks/useBluetooth";
import { match } from "ts-pattern";
import { client } from "../../lib/apiClient";
import { getErrorMessage } from "../../utils/error";

export const Route = createFileRoute("/device/connect")({
  component: Page,
  staticData: {
    layout: {
      pageTitle: "Connect device",
      hideNav: true,
      closeButton: true,
    },
  },
});

function Page() {
  const router = useRouter();

  const [deviceId, setDeviceId] = useState("");
  const [view, setView] = useState<"main" | "provision" | "save">("main");

  const { isSupported } = useBluetooth();

  return (
    <div style={{ viewTransitionName: "main-content" }}>
      {match({ view, isSupported })
        .with({ view: "main", isSupported: false }, () => (
          <div>
            <Text>Here we need WIFI provision setup explanation.</Text>
            <button
              onClick={() => {
                setDeviceId("test-device-id");
                setView("save");
              }}
            >
              Add Test device
            </button>
          </div>
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
        .with({ view: "save" }, () => <SaveDevice deviceId={deviceId} />)
        .exhaustive()}
    </div>
  );
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
        <Group direction="column" align="center" spacing="xl">
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
    <Group direction="column" spacing="xl">
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

function SaveDevice({ deviceId }: { deviceId: string }) {
  const router = useRouter();

  const [name, setName] = useState("");

  const { mutate: createDevice, error } = client.api.createDevice.useMutation(
    undefined,
    {
      onSuccess: () => {
        router.navigate({ to: "/" });
      },
    }
  );

  return (
    <Group direction="column" spacing="xl">
      <Input
        full
        onChange={(e) => setName(e.target.value)}
        value={name}
        label="Name"
        placeholder="My Ortus"
      />
      <Button
        full
        onClick={() => {
          createDevice({
            body: { name, unique_id: deviceId, organization_id: 1 },
          });
        }}
      >
        Save
      </Button>
      {error ? getErrorMessage(error) : null}
    </Group>
  );
}
