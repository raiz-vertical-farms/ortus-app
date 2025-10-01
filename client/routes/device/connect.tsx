import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import { Text } from "../../primitives/Text/Text";
import BluetoothDeviceCard from "../../components/BluetoothDeviceCard/BluetoothDeviceCard";
import Input from "../../primitives/Input/Input";
import { useEffect, useState } from "react";
import { useBluetooth } from "../../hooks/useBluetooth";
import { match } from "ts-pattern";
import { client } from "../../lib/apiClient";
import { getErrorMessage } from "../../utils/error";
import { getPublicIp } from "../../utils/ip";
import Box from "../../primitives/Box/Box";

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
  const [view, setView] = useState<"main" | "provision" | "save">("main");
  const [ip, setIp] = useState("");
  const [macAddress, setMacAddress] = useState("");

  useEffect(() => {
    getPublicIp().then(setIp);
  }, []);

  const { isSupported } = useBluetooth();

  return (
    <div style={{ viewTransitionName: "main-content" }}>
      {match({ view, isSupported })
        .with({ view: "main", isSupported: false }, () => (
          <WifiProvision
            ip={ip}
            macAddress={macAddress}
            onSaveDevice={() => setView("save")}
            onMacAddressChange={setMacAddress}
          />
        ))
        .with({ view: "main", isSupported: true }, () => (
          <FindDevice
            ip={ip}
            onDeviceSelected={(macAddress) => {
              setMacAddress(macAddress);
              setView("provision");
            }}
          />
        ))
        .with({ view: "provision" }, () => (
          <ProvisionDevice
            onSuccess={(mac) => {
              setMacAddress(mac);
              setView("save");
            }}
          />
        ))
        .with({ view: "save" }, () => <SaveDevice deviceId={macAddress} />)
        .exhaustive()}
    </div>
  );
}

function WifiProvision({
  ip,
  macAddress,
  onMacAddressChange,
  onSaveDevice,
}: {
  ip: string;
  macAddress: string;
  onSaveDevice: () => void;
  onMacAddressChange: (macAddress: string) => void;
}) {
  const { data: localDevices } = client.api.localDevices.useQuery(
    { query: { ip } },
    {
      refetchInterval: 2000,
      enabled: !!ip,
    }
  );

  const devices = localDevices || [];

  return (
    <div>
      <Box pb="3xl">
        <Text>Here we need WIFI provision setup explanation.</Text>
      </Box>
      <Text>
        {devices.length === 0
          ? "Looking for devices on your network..."
          : "Devices found"}
      </Text>
      {devices.map((device) => (
        <Box
          p="xl"
          style={{
            cursor: "pointer",
            background: "white",
            borderRadius: "4px",
            border: "1px solid black",
          }}
          onClick={() => {
            onMacAddressChange(device.mac_address);
            onSaveDevice();
          }}
          key={device.mac_address}
        >
          <Text>Ortus</Text>
          <Text>{device.mac_address}</Text>
        </Box>
      ))}
      <Box py="md">
        <Text>Or you can enter MAC address manually</Text>
      </Box>
      <Group align="center" spacing="lg">
        <Input
          placeholder="00:00:00:00:00:00"
          full
          value={macAddress}
          onChange={(e) => onMacAddressChange(e.target.value)}
        />
        <Button onClick={onSaveDevice}>Add device</Button>
      </Group>
    </div>
  );
}

function FindDevice({
  onDeviceSelected,
  ip,
}: {
  ip: string;
  onDeviceSelected: (deviceId: string) => void;
}) {
  const { scanAndConnect, status, isConnected, macAddress, initialize } =
    useBluetooth();

  return (
    <Group direction="column" spacing="xl">
      <Button
        onClick={async () => {
          await initialize();
          const ok = await scanAndConnect();
          if (ok && macAddress) {
            onDeviceSelected(macAddress);
          }
        }}
      >
        Scan & Connect
      </Button>
      <Text>{status}</Text>
      {isConnected && macAddress && <Text>Connected to {macAddress}</Text>}
    </Group>
  );
}

function ProvisionDevice({ onSuccess }: { onSuccess: (mac: string) => void }) {
  const [ssid, setSsid] = useState("Vodafone-166BC8");
  const [password, setPassword] = useState("ZeMzq5mn5avqYuVp");

  const { provisionWiFi, status, isProvisioning } = useBluetooth();

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
        disabled={isProvisioning}
        onClick={async () => {
          try {
            const mac = await provisionWiFi(ssid, password);
            if (mac) {
              onSuccess(mac);
            }
          } catch (error) {
            console.error("Provisioning failed:", error);
          }
        }}
      >
        {isProvisioning ? "Provisioning..." : "Connect Ortus to WiFi"}
      </Button>
      <Text>{status}</Text>
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
            body: { name, mac_address: deviceId, organization_id: 1 },
          });
        }}
      >
        Save
      </Button>
      {error ? getErrorMessage(error) : null}
    </Group>
  );
}
