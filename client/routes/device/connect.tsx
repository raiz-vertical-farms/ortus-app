import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { match } from "ts-pattern";
import Box from "../../primitives/Box/Box";
import Button from "../../primitives/Button/Button";
import { Group } from "../../primitives/Group/Group";
import Input from "../../primitives/Input/Input";
import { Text } from "../../primitives/Text/Text";
import { client } from "../../lib/apiClient";
import { getErrorMessage } from "../../utils/error";
import PageLayout from "../../layout/PageLayout/PageLayout";
import ProvisionFlow from "../../components/ProvisionFlow/ProvisionFlow";

export const Route = createFileRoute("/device/connect")({
  component: Page,
  staticData: {
    layout: {
      hideNav: true,
    },
  },
});

function Page() {
  const [view, setView] = useState<"main" | "save">("main");
  const [macAddress, setMacAddress] = useState("");

  const handleProvisionSucceeded = (mac: string) => {
    setMacAddress(mac);
    setView("save");
  };

  return (
    <PageLayout layout={{ pageTitle: "Connect Your Ortus", closeButton: true }}>
      {match({ view })
        .with({ view: "main" }, () => (
          <Box pt="6xl">
            <ProvisionFlow onProvisionSucceeded={handleProvisionSucceeded} />
          </Box>
        ))
        .with({ view: "save" }, () => <SaveDevice deviceId={macAddress} />)
        .exhaustive()}
    </PageLayout>
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
          size="lg"
          onClick={() => {
            createDevice({
              body: { name, mac_address: deviceId },
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
