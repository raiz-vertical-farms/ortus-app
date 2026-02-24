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
  const [view, setView] = useState<"main" | "mac" | "save">("main");
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
            <Box pt="xl" style={{ textAlign: "center" }}>
              <button
                onClick={() => setView("mac")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "inherit",
                  color: "inherit",
                  opacity: 0.6,
                }}
              >
                Connect with mac address
              </button>
            </Box>
          </Box>
        ))
        .with({ view: "mac" }, () => (
          <EnterMacAddress
            onSubmit={(mac) => {
              setMacAddress(mac);
              setView("save");
            }}
            onBack={() => setView("main")}
          />
        ))
        .with({ view: "save" }, () => <SaveDevice deviceId={macAddress} />)
        .exhaustive()}
    </PageLayout>
  );
}

function EnterMacAddress({
  onSubmit,
  onBack,
}: {
  onSubmit: (mac: string) => void;
  onBack: () => void;
}) {
  const [mac, setMac] = useState("");

  return (
    <Box pt="6xl">
      <Group direction="column" spacing="xl">
        <Input
          full
          inputSize="lg"
          label="Mac address"
          placeholder="AA:BB:CC:DD:EE:FF"
          value={mac}
          onChange={(e) => setMac(e.target.value)}
        />
        <Button size="lg" onClick={() => onSubmit(mac)} disabled={!mac.trim()}>
          Continue
        </Button>
        <Box style={{ textAlign: "center" }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: "inherit",
              color: "inherit",
              opacity: 0.6,
            }}
          >
            Back
          </button>
        </Box>
      </Group>
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
