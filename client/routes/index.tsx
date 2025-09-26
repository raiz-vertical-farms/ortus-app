import { createFileRoute } from "@tanstack/react-router";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { useMutation, useQuery } from "../hooks";
import { apiClient } from "../lib/hono-client";
import Modal from "../primitives/Modal/Modal";
import { useState } from "react";
import Input from "../primitives/Input/Input";
import DeviceCard from "../components/DeviceCard/DeviceCard";
import BluetoothDeviceCard from "../components/BluetoothDeviceCard/BluetoothDeviceCard";
import { useBluetooth } from "../hooks/useBluetooth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [uniqueId, setUniqueId] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [openProvision, setOpenProvision] = useState(false);
  const [provisioningDeviceId, setProvisioningDeviceId] = useState<
    string | null
  >(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");

  const { startScan, devices, isSupported, isScanning, provisionDevice } =
    useBluetooth();

  console.log("Is Bluetooth supported?", isSupported);

  const { mutate: changeLight } = useMutation(
    apiClient.device[":id"].light[":lightId"].$post
  );
  const { mutate: createDevice } = useMutation(apiClient.device.create.$post);

  const { data, refetch } = useQuery(
    apiClient.device.devices.$get,
    {},
    { pollInterval: 3000 }
  );

  return (
    <Container
      style={{
        minHeight: "calc(100dvh - 60px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Group direction="column" align="center" spacing="5">
        {devices.length > 0 && (
          <>
            <h2>Discovered Devices</h2>
            {devices.map((device) => (
              <BluetoothDeviceCard
                key={device.device.deviceId}
                result={device}
                onClick={() => {
                  setProvisioningDeviceId(device.device.deviceId);
                  setOpenProvision(true);
                }}
              />
            ))}
          </>
        )}
      </Group>
      <Group direction="column" align="center" spacing="5">
        {data?.devices.map((device) => {
          if (!device.id) return null;

          return (
            <DeviceCard
              key={device.id}
              id={device.id}
              name={device.name}
              unique_id={device.unique_id}
              light_state={device.light_state}
              last_seen={device.last_seen}
            />
          );
        })}
        {isSupported ? (
          <Button size="lg" full onClick={startScan}>
            {isScanning ? "Scanning..." : "Scan for Ortus devices"}
          </Button>
        ) : (
          <Button size="lg" full onClick={() => setOpen(true)}>
            Add an Ortus
          </Button>
        )}
      </Group>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a new Ortus">
        <Group direction="column" spacing="5">
          <Input
            full
            onChange={(e) => setName(e.target.value)}
            value={name}
            label="Name"
            placeholder="My Ortus"
          />
          <Input
            full
            onChange={(e) => setUniqueId(e.target.value)}
            value={uniqueId}
            label="Unique ID"
            placeholder="123e4567-e89b-12d3-a456-426614174000"
          />
          <Button
            full
            onClick={() =>
              createDevice({
                json: { name, unique_id: uniqueId, organization_id: 1 },
              }).then(() => {
                setOpen(false);
                refetch();
              })
            }
          >
            Add
          </Button>
        </Group>
      </Modal>
      <Modal
        open={openProvision}
        onClose={() => setOpenProvision(false)}
        title="Connect the Ortus to your WiFi network"
      >
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
              if (!provisioningDeviceId) return;

              try {
                await provisionDevice(provisioningDeviceId, ssid, password);
                setOpenProvision(false);
              } catch (error) {
                console.error("Provisioning failed:", error);
              }
            }}
          >
            Provision
          </Button>
        </Group>
      </Modal>
    </Container>
  );
}
