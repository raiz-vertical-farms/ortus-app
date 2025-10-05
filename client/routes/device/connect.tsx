import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { match } from "ts-pattern";

import BluetoothDeviceCard from "../../components/BluetoothDeviceCard/BluetoothDeviceCard";
import { useBluetooth, type UseBluetoothReturn } from "../../hooks/useBluetooth";
import Box from "../../primitives/Box/Box";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import Input from "../../primitives/Input/Input";
import { Text } from "../../primitives/Text/Text";
import { client } from "../../lib/apiClient";
import { getErrorMessage } from "../../utils/error";

export const Route = createFileRoute("/device/connect")({
  component: Page,
  staticData: {
    layout: {
      pageTitle: "Connect Your Ortus",
      hideNav: true,
      closeButton: true,
    },
  },
});

function Page() {
  const router = useRouter();
  const [view, setView] = useState<"main" | "save">("main");
  const [macAddress, setMacAddress] = useState("");

  const bluetooth = useBluetooth();

  const handleProvisionSucceeded = (mac: string) => {
    setMacAddress(mac);
    setView("save");
  };

  return (
    <div style={{ viewTransitionName: "main-content" }}>
      {match({ view, implementation: bluetooth.implementation })
        .with({ view: "main", implementation: "capacitor" }, () => (
          <BluetoothProvision
            bluetooth={bluetooth}
            onProvisionSucceeded={handleProvisionSucceeded}
          />
        ))
        .with({ view: "main", implementation: "web" }, () => (
          <WebBluetooth
            bluetooth={bluetooth}
            onProvisionSucceeded={handleProvisionSucceeded}
          />
        ))
        .with({ view: "main" }, () => <WebBluetoothUnsupported />)
        .with({ view: "save" }, () => <SaveDevice deviceId={macAddress} />)
        .exhaustive()}
    </div>
  );
}

function BluetoothProvision({
  bluetooth,
  onProvisionSucceeded,
}: {
  bluetooth: UseBluetoothReturn;
  onProvisionSucceeded: (mac: string) => void;
}) {
  return (
    <ProvisionFlow
      variant="capacitor"
      bluetooth={bluetooth}
      onProvisionSucceeded={onProvisionSucceeded}
    />
  );
}

function WebBluetooth({
  bluetooth,
  onProvisionSucceeded,
}: {
  bluetooth: UseBluetoothReturn;
  onProvisionSucceeded: (mac: string) => void;
}) {
  return (
    <ProvisionFlow
      variant="web"
      bluetooth={bluetooth}
      onProvisionSucceeded={onProvisionSucceeded}
    />
  );
}

function ProvisionFlow({
  bluetooth,
  onProvisionSucceeded,
  variant,
}: {
  bluetooth: UseBluetoothReturn;
  onProvisionSucceeded: (mac: string) => void;
  variant: "capacitor" | "web";
}) {
  const [hasScanned, setHasScanned] = useState(false);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");

  const {
    devices,
    isScanning,
    scanForDevices,
    initialize,
    isConnected,
    connect,
    provision,
    isProvisioning,
    status,
  } = bluetooth;

  const scanButtonLabel = variant === "web" ? "Select Ortus" : "Scan for Ortus";
  const idleCopy =
    variant === "web"
      ? "Use Web Bluetooth to find your Ortus, then share Wi-Fi so it can start growing."
      : "Scan for your Ortus over Bluetooth, then share your Wi-Fi so it can start growing.";

  const handleScan = async () => {
    try {
      await initialize();
      await scanForDevices();
      setHasScanned(true);
    } catch (error) {
      if (
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "NotFoundError"
      ) {
        return;
      }

      console.error("Scan failed", error);
    }
  };

  const handleConnect = async (deviceId: string) => {
    try {
      await connect(deviceId);
    } catch (error) {
      console.error("Connection failed", error);
    }
  };

  return match({ isConnected })
    .with({ isConnected: true }, () => (
      <Box pt="7xl">
        <Box pb="3xl">
          <Text size="lg" align="center">
            Let Ortus hop onto your Wi-Fi
          </Text>
        </Box>
        <Group direction="column" spacing="md">
          <Input
            full
            inputSize="lg"
            label="Wi-Fi name (SSID)"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
          />
          <Input
            full
            inputSize="lg"
            label="Wi-Fi password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            size="lg"
            full
            disabled={isProvisioning}
            onClick={async () => {
              try {
                const mac = await provision(ssid, password);
                onProvisionSucceeded(mac);
              } catch (error) {
                console.error("Provisioning failed", error);
              }
            }}
          >
            {isProvisioning ? "Sending Wi-Fi details..." : "Connect to Wi-Fi"}
          </Button>
        </Group>
      </Box>
    ))
    .otherwise(() => (
      <Box pt="7xl">
        <Group direction="column" align="center" spacing="xl">
          {devices.length > 0 ? null : hasScanned ? (
            <Text>No Ortus found yet.</Text>
          ) : (
            <Text>{idleCopy}</Text>
          )}
          {devices.map((device) => (
            <BluetoothDeviceCard
              key={device.deviceId}
              name={device.name}
              deviceId={device.deviceId}
              onClick={() => handleConnect(device.deviceId)}
            />
          ))}
          <Button full disabled={isScanning} onClick={handleScan}>
            {isScanning ? "Scanning..." : scanButtonLabel}
          </Button>
          {status ? <Text>{status}</Text> : null}
        </Group>
      </Box>
    ));
}

function WebBluetoothUnsupported() {
  return (
    <Box pt="7xl">
      <Text align="center">
        Web Bluetooth is not available in this browser yet. Please continue in
        the Raiz mobile app to connect your Ortus.
      </Text>
    </Box>
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
    <Box pt="6xl">
      <Group direction="column" spacing="xl">
        <Input
          full
          inputSize="lg"
          onChange={(e) => setName(e.target.value)}
          value={name}
          label="Name your garden"
          placeholder="Kitchen herb tower"
        />
        <Button
          full
          size="lg"
          onClick={() => {
            createDevice({
              body: { name, mac_address: deviceId, organization_id: 1 },
            });
          }}
        >
          Save this Ortus
        </Button>
        {error ? <Text>{getErrorMessage(error)}</Text> : null}
      </Group>
    </Box>
  );
}
