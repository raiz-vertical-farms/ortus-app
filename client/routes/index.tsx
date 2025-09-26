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
import { useBluetooth } from "../hooks/useBluetooth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [uniqueId, setUniqueId] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const { isEnabled, startScan, devices, isSupported, isScanning } =
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
              <div
                key={device.device.deviceId}
                style={{
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  padding: "10px",
                  marginBottom: "10px",
                  width: "100%",
                  maxWidth: "400px",
                }}
              >
                <p>
                  <strong>Name:</strong>{" "}
                  {device.device.name || "Unknown Device"}
                </p>
                <p>
                  <strong>ID:</strong> {device.device.deviceId}
                </p>
              </div>
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
    </Container>
  );
}
