import { createFileRoute } from "@tanstack/react-router";
import { Text } from "../primitives/Text/Text";
import Container from "../primitives/Container/Container";
import Button from "../primitives/Button/Button";
import { Group } from "../primitives/Group/Group";
import { useMutation, useQuery } from "../hooks";
import { apiClient } from "../lib/hono-client";
import Modal from "../primitives/Modal/Modal";
import { useState } from "react";
import Input from "../primitives/Input/Input";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [uniqueId, setUniqueId] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const { mutate: changeLight } = useMutation(
    apiClient.device[":id"].light[":lightId"].$post
  );
  const { mutate: createDevice } = useMutation(apiClient.device.create.$post);

  const { data, refetch } = useQuery(apiClient.device.devices.$get, {});

  return (
    <Container
      style={{ height: "100vh", display: "grid", placeItems: "center" }}
    >
      <Group direction="column" align="center" spacing="10">
        {data?.devices.map((device) => (
          <Text key={device.id}>
            {device.name} - {device.unique_id} - {device.light_state}
            <Button
              onClick={() => {
                if (device.id && device.light_state) {
                  const newState = device.light_state === "ON" ? "OFF" : "ON";
                  changeLight({
                    param: { id: device.id.toString(), lightId: "light" },
                    json: { state: newState },
                  }).then(() => refetch());
                }
              }}
            >
              Toggle
            </Button>
          </Text>
        ))}
        <Button onClick={() => setOpen(true)}>Add an Ortus</Button>
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
