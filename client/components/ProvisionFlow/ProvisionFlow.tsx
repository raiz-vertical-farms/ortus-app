import { useState } from "react";
import { useBluetooth } from "../../hooks/useBluetooth";
import Box from "../../primitives/Box/Box";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";
import Input from "../../primitives/Input/Input";
import Button from "../../primitives/Button/Button";
import BluetoothDeviceCard from "../BluetoothDeviceCard/BluetoothDeviceCard";
import { match } from "ts-pattern";

export default function ProvisionFlow({
  onConnected = () => {},
  onProvisionSucceeded = () => {},
}: {
  onConnected?: (mac: string) => void;
  onProvisionSucceeded?: (mac: string) => void;
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
    implementation,
    macAddress,
    connect,
    provision,
    isProvisioning,
    status,
  } = useBluetooth();

  const scanButtonLabel =
    implementation === "web" ? "Select Ortus" : "Scan for Ortus";
  const idleCopy =
    implementation === "web"
      ? "Use Web Bluetooth to find your Ortus, then share Wi-Fi so it can start growing."
      : "Scan for your Ortus over Bluetooth, then share your Wi-Fi so it can start growing.";

  const handleScan = async () => {
    try {
      await initialize();
      if (implementation === "capacitor") {
        await scanForDevices();
      }
      if (implementation === "web") {
        const devices = await scanForDevices();
        if (devices.length > 0) {
          await connect(devices[0].deviceId);
        }
      }
      setHasScanned(true);
    } catch (error) {
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

  if (implementation === "unsupported") {
    return (
      <Box>
        <Text align="center">
          Web Bluetooth is not available in this browser yet. Please continue in
          the Raiz mobile app to connect your Ortus.
        </Text>
      </Box>
    );
  }

  return match({ isConnected })
    .with({ isConnected: true }, () => (
      <Box>
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
      <Box>
        <Group direction="column" align="center" spacing="xl">
          {devices.length > 0 ? null : hasScanned ? (
            <Text>No Ortus found yet.</Text>
          ) : (
            <Text>{idleCopy}</Text>
          )}
          {implementation === "capacitor" &&
            devices.map((device) => (
              <BluetoothDeviceCard
                key={device.deviceId}
                name={device.name}
                onClick={() => handleConnect(device.deviceId)}
              />
            ))}
          <div>
            <Button disabled={isScanning} onClick={handleScan}>
              {isScanning ? "Scanning..." : scanButtonLabel}
            </Button>
          </div>
          {status ? <Text>{status}</Text> : null}
        </Group>
      </Box>
    ));
}
