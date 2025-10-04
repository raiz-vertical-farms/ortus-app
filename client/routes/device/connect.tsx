import { createFileRoute, useRouter } from "@tanstack/react-router";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import { Text } from "../../primitives/Text/Text";
import Input from "../../primitives/Input/Input";
import { useEffect, useState } from "react";
import { useBluetooth } from "../../hooks/useBluetooth";
import { match } from "ts-pattern";
import { client } from "../../lib/apiClient";
import { getErrorMessage } from "../../utils/error";
import { getPublicIp } from "../../utils/ip";
import Box from "../../primitives/Box/Box";
import { getCurrentSSID } from "../../utils/network";
import BluetoothDeviceCard from "../../components/BluetoothDeviceCard/BluetoothDeviceCard";

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
  const [view, setView] = useState<"main" | "save">("main");
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
          <BluetoothProvision
            onProvisionSucceeded={(mac) => {
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
      You need the app to be able to provision your Ortus device via Bluetooth.
    </div>
  );
}

function BluetoothProvision({
  onProvisionSucceeded,
}: {
  onProvisionSucceeded: (mac: string) => void;
}) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const {
    devices,
    scanForDevices,
    initialize,
    isConnected,
    connect,
    provision,
    isProvisioning,
    status,
  } = useBluetooth();

  return match({ isConnected })
    .with({ isConnected: true }, () => {
      return (
        <Box pt="7xl">
          <Box pb="3xl">
            <Text size="lg">Give your Ortus access to your network</Text>
          </Box>
          <Group direction="column" spacing="md">
            <Input
              full
              inputSize="lg"
              label="SSID"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
            />
            <Input
              full
              inputSize="lg"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              size="lg"
              full
              disabled={isProvisioning}
              onClick={() =>
                provision(ssid, password).then(onProvisionSucceeded)
              }
            >
              {isProvisioning
                ? "Giving credentials to device..."
                : "Connect to network"}
            </Button>
          </Group>
        </Box>
      );
    })
    .with({ isConnected: false }, () => {
      return (
        <Box pt="7xl">
          {devices.map((device) => (
            <BluetoothDeviceCard
              name={device.name}
              deviceId={device.deviceId}
              onClick={() =>
                connect(device.deviceId).then(() => {
                  getCurrentSSID()
                    .then((val) => setSsid(val))
                    .catch((e) => {
                      console.error(e);
                    });
                })
              }
            />
          ))}
          <Group direction="column" spacing="xl">
            <Button
              onClick={async () => {
                await initialize();
                await scanForDevices();
              }}
            >
              Scan for devices
            </Button>
            <Text>{status}</Text>
          </Group>
        </Box>
      );
    })
    .exhaustive();
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
