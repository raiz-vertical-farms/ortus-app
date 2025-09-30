import { createFileRoute } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type SetStateAction,
} from "react";
import { match } from "ts-pattern";
import { Group } from "../../primitives/Group/Group";
import Tabs from "../../primitives/Tabs/Tabs";
import Button from "../../primitives/Button/Button";
import Input from "../../primitives/Input/Input";
import type { paths } from "../../api";

type DeviceStateResponse =
  paths["/api/device/{id}/state"]["get"]["responses"]["200"]["content"]["application/json"];
type DeviceState = DeviceStateResponse["state"];
type LightSchedule = NonNullable<DeviceState["left_light_schedule"]>;
type LightSchedulePayload =
  paths["/api/device/{id}/left-light/schedule"]["post"]["requestBody"]["content"]["application/json"];
type LightState = "on" | "off";

const cardStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
};

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const device = await client.api.deviceState({
      parameters: { path: { id: params.id } },
    });

    return {
      layout: {
        pageTitle: device.data?.state.name || "Device",
        backButton: true,
      },
    };
  },
});

function RouteComponent() {
  const { id } = Route.useParams();

  const [view, setView] = useState<"control" | "plants">("control");

  const { data, error, isLoading } = client.api.deviceState.useQuery({
    path: { id },
  });

  if (isLoading || !data) {
    return "Loading...";
  }

  if (error) {
    return getErrorMessage(error);
  }

  return (
    <Box pt="xl">
      <Group spacing="xl" justify="center">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "control", label: "Control" },
            { value: "plants", label: "Plants" },
          ]}
        />
      </Group>
      {match(view)
        .with("control", () => <ControlView deviceId={id} />)
        .with("plants", () => <Text>Plants view coming soon!</Text>)
        .exhaustive()}
    </Box>
  );
}

function ControlView({ deviceId }: { deviceId: string }) {
  const { data, error, isLoading } = client.api.deviceState.useQuery({
    path: { id: deviceId },
  });

  const [leftScheduleForm, setLeftScheduleForm] = useState<ScheduleFormState>(
    () => createEmptyScheduleForm()
  );
  const [rightScheduleForm, setRightScheduleForm] = useState<ScheduleFormState>(
    () => createEmptyScheduleForm()
  );
  const [leftScheduleFormError, setLeftScheduleFormError] =
    useState<string | null>(null);
  const [rightScheduleFormError, setRightScheduleFormError] =
    useState<string | null>(null);

  const invalidateDeviceState = useCallback(async () => {
    const queryKey = client.api.deviceState.getQueryKey({
      path: { id: deviceId },
    });

    await client.api.deviceState.invalidateQueries({ queryKey });
  }, [deviceId]);

  const {
    mutate: toggleLeftLight,
    isPending: isTogglingLeftLight,
    error: toggleLeftLightError,
  } = client.api.toggleLeftLight.useMutation(
    { path: { id: deviceId } },
    {
      onSuccess: async () => {
        await invalidateDeviceState();
      },
    }
  );

  const {
    mutate: toggleRightLight,
    isPending: isTogglingRightLight,
    error: toggleRightLightError,
  } = client.api.toggleRightLight.useMutation(
    { path: { id: deviceId } },
    {
      onSuccess: async () => {
        await invalidateDeviceState();
      },
    }
  );

  const {
    mutate: scheduleLeftLight,
    isPending: isSchedulingLeftLight,
    error: scheduleLeftLightError,
  } = client.api.scheduleLeftLight.useMutation(
    { path: { id: deviceId } },
    {
      onSuccess: async () => {
        setLeftScheduleFormError(null);
        await invalidateDeviceState();
      },
    }
  );

  const {
    mutate: scheduleRightLight,
    isPending: isSchedulingRightLight,
    error: scheduleRightLightError,
  } = client.api.scheduleRightLight.useMutation(
    { path: { id: deviceId } },
    {
      onSuccess: async () => {
        setRightScheduleFormError(null);
        await invalidateDeviceState();
      },
    }
  );

  useEffect(() => {
    if (!data?.state) {
      return;
    }

    const nextForm = scheduleEntryToFormOrEmpty(
      data.state.left_light_schedule
    );
    setLeftScheduleForm((prev) =>
      scheduleFormsEqual(prev, nextForm) ? prev : nextForm
    );
  }, [data?.state?.left_light_schedule]);

  useEffect(() => {
    if (!data?.state) {
      return;
    }

    const nextForm = scheduleEntryToFormOrEmpty(
      data.state.right_light_schedule
    );
    setRightScheduleForm((prev) =>
      scheduleFormsEqual(prev, nextForm) ? prev : nextForm
    );
  }, [data?.state?.right_light_schedule]);

  if (error) {
    return <Text>{getErrorMessage(error)}</Text>;
  }

  if (isLoading || !data?.state) {
    return <Text>Loading...</Text>;
  }

  const { state } = data;

  const handleToggleLeft = (nextState: LightState) => {
    toggleLeftLight({ state: nextState });
  };

  const handleToggleRight = (nextState: LightState) => {
    toggleRightLight({ state: nextState });
  };

  const handleLeftScheduleSubmit = () => {
    const parsed = parseSchedule(leftScheduleForm);
    if (parsed.error) {
      setLeftScheduleFormError(parsed.error);
      return;
    }

    setLeftScheduleFormError(null);
    scheduleLeftLight(parsed.value);
  };

  const handleRightScheduleSubmit = () => {
    const parsed = parseSchedule(rightScheduleForm);
    if (parsed.error) {
      setRightScheduleFormError(parsed.error);
      return;
    }

    setRightScheduleFormError(null);
    scheduleRightLight(parsed.value);
  };

  const leftLightStatus: LightState = state.left_light === "on" ? "on" : "off";
  const rightLightStatus: LightState =
    state.right_light === "on" ? "on" : "off";

  const scheduleInputs = useMemo(
    () => [
      {
        label: "From hour",
        key: "from_hour" as const,
        min: 0,
        max: 23,
      },
      {
        label: "From minute",
        key: "from_minute" as const,
        min: 0,
        max: 59,
      },
      {
        label: "To hour",
        key: "to_hour" as const,
        min: 0,
        max: 23,
      },
      {
        label: "To minute",
        key: "to_minute" as const,
        min: 0,
        max: 59,
      },
    ],
    []
  );

  return (
    <Box mt="xl">
      <Group direction="column" spacing="2xl">
        <Box>
          <Text tag="h2" variant="heading" size="xl">
            Lights
          </Text>
          <Group spacing="xl" wrap style={{ marginTop: "var(--spacing-lg)" }}>
            <Box p="md" style={cardStyle}>
              <Text weight="semibold">Left light</Text>
              <Text color="muted" style={{ marginTop: "var(--spacing-xs)" }}>
                Status: {leftLightStatus.toUpperCase()}
              </Text>
              <Group spacing="sm" style={{ marginTop: "var(--spacing-sm)" }}>
                <Button
                  onClick={() => handleToggleLeft("on")}
                  disabled={isTogglingLeftLight}
                >
                  Turn on
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleToggleLeft("off")}
                  disabled={isTogglingLeftLight}
                >
                  Turn off
                </Button>
              </Group>
              {toggleLeftLightError && (
                <Text color="strong" style={{ marginTop: "var(--spacing-xs)" }}>
                  {getErrorMessage(toggleLeftLightError)}
                </Text>
              )}
            </Box>
            <Box p="md" style={cardStyle}>
              <Text weight="semibold">Right light</Text>
              <Text color="muted" style={{ marginTop: "var(--spacing-xs)" }}>
                Status: {rightLightStatus.toUpperCase()}
              </Text>
              <Group spacing="sm" style={{ marginTop: "var(--spacing-sm)" }}>
                <Button
                  onClick={() => handleToggleRight("on")}
                  disabled={isTogglingRightLight}
                >
                  Turn on
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleToggleRight("off")}
                  disabled={isTogglingRightLight}
                >
                  Turn off
                </Button>
              </Group>
              {toggleRightLightError && (
                <Text color="strong" style={{ marginTop: "var(--spacing-xs)" }}>
                  {getErrorMessage(toggleRightLightError)}
                </Text>
              )}
            </Box>
          </Group>
        </Box>

        <Box>
          <Text tag="h2" variant="heading" size="xl">
            Light schedules
          </Text>
          <Group
            direction="column"
            spacing="xl"
            style={{ marginTop: "var(--spacing-lg)" }}
          >
            <ScheduleCard
              title="Left light schedule"
              description="Configure a 24h window for when the left light is active."
              formState={leftScheduleForm}
              onChange={setLeftScheduleForm}
              onSubmit={handleLeftScheduleSubmit}
              isSubmitting={isSchedulingLeftLight}
              currentSchedule={state.left_light_schedule}
              formError={leftScheduleFormError}
              mutationError={scheduleLeftLightError}
              inputs={scheduleInputs}
            />

            <ScheduleCard
              title="Right light schedule"
              description="Configure a 24h window for when the right light is active."
              formState={rightScheduleForm}
              onChange={setRightScheduleForm}
              onSubmit={handleRightScheduleSubmit}
              isSubmitting={isSchedulingRightLight}
              currentSchedule={state.right_light_schedule}
              formError={rightScheduleFormError}
              mutationError={scheduleRightLightError}
              inputs={scheduleInputs}
            />
          </Group>
        </Box>

        <Box>
          <Text tag="h2" variant="heading" size="xl">
            Water
          </Text>
          <Text style={{ marginTop: "var(--spacing-sm)" }}>
            Current water level: {state.water_level ?? "unknown"}
          </Text>
        </Box>
      </Group>
    </Box>
  );
}
type ScheduleFormState = {
  from_hour: string;
  from_minute: string;
  to_hour: string;
  to_minute: string;
};

type ScheduleInputConfig = {
  label: string;
  key: keyof ScheduleFormState;
  min: number;
  max: number;
};

type ScheduleCardProps = {
  title: string;
  description: string;
  formState: ScheduleFormState;
  onChange: Dispatch<SetStateAction<ScheduleFormState>>;
  onSubmit: () => void;
  isSubmitting: boolean;
  currentSchedule: DeviceState["left_light_schedule"];
  formError: string | null;
  mutationError: unknown;
  inputs: ScheduleInputConfig[];
};

function ScheduleCard({
  title,
  description,
  formState,
  onChange,
  onSubmit,
  isSubmitting,
  currentSchedule,
  formError,
  mutationError,
  inputs,
}: ScheduleCardProps) {
  return (
    <Box p="md" style={cardStyle}>
      <Text weight="semibold">{title}</Text>
      <Text color="muted" style={{ marginTop: "var(--spacing-xs)" }}>
        {description}
      </Text>
      <Group spacing="sm" style={{ marginTop: "var(--spacing-sm)" }}>
        {inputs.map(({ label, key, min, max }) => (
          <Input
            key={key}
            label={label}
            type="number"
            min={min}
            max={max}
            value={formState[key]}
            onChange={(event) =>
              onChange((prev) => ({
                ...prev,
                [key]: event.target.value,
              }))
            }
            inputSize="sm"
          />
        ))}
      </Group>
      <Group spacing="sm" style={{ marginTop: "var(--spacing-sm)" }}>
        <Button onClick={onSubmit} disabled={isSubmitting}>
          Save
        </Button>
        {currentSchedule ? (
          <Text color="muted">
            Current: {formatScheduleEntry(currentSchedule)}
          </Text>
        ) : (
          <Text color="muted">No schedule configured.</Text>
        )}
      </Group>
      {formError && (
        <Text color="strong" style={{ marginTop: "var(--spacing-xs)" }}>
          {formError}
        </Text>
      )}
      {mutationError && (
        <Text color="strong" style={{ marginTop: "var(--spacing-xs)" }}>
          {getErrorMessage(mutationError)}
        </Text>
      )}
    </Box>
  );
}

function createEmptyScheduleForm(): ScheduleFormState {
  return {
    from_hour: "",
    from_minute: "",
    to_hour: "",
    to_minute: "",
  };
}

function scheduleEntryToForm(entry: LightSchedule): ScheduleFormState {
  return {
    from_hour: entry.from_hour.toString(),
    from_minute: entry.from_minute.toString(),
    to_hour: entry.to_hour.toString(),
    to_minute: entry.to_minute.toString(),
  };
}

function scheduleEntryToFormOrEmpty(
  entry: DeviceState["left_light_schedule"]
): ScheduleFormState {
  return entry ? scheduleEntryToForm(entry) : createEmptyScheduleForm();
}

function scheduleFormsEqual(
  a: ScheduleFormState,
  b: ScheduleFormState
): boolean {
  return (
    a.from_hour === b.from_hour &&
    a.from_minute === b.from_minute &&
    a.to_hour === b.to_hour &&
    a.to_minute === b.to_minute
  );
}

function parseSchedule(
  form: ScheduleFormState
): { value: LightSchedulePayload } | { error: string } {
  const requiredFields = [
    form.from_hour,
    form.from_minute,
    form.to_hour,
    form.to_minute,
  ];

  if (requiredFields.some((field) => field.trim() === "")) {
    return { error: "All schedule fields are required." };
  }

  const payload: LightSchedulePayload = {
    from_hour: Number(form.from_hour),
    from_minute: Number(form.from_minute),
    to_hour: Number(form.to_hour),
    to_minute: Number(form.to_minute),
  };

  const isInvalidNumber = (value: number) =>
    Number.isNaN(value) || !Number.isFinite(value);

  if (Object.values(payload).some(isInvalidNumber)) {
    return { error: "Schedule values must be valid numbers." };
  }

  const isNonInteger = (value: number) => !Number.isInteger(value);

  if (Object.values(payload).some(isNonInteger)) {
    return { error: "Schedule values must be whole numbers." };
  }

  const isOutOfRange =
    payload.from_hour < 0 ||
    payload.from_hour > 23 ||
    payload.to_hour < 0 ||
    payload.to_hour > 23 ||
    payload.from_minute < 0 ||
    payload.from_minute > 59 ||
    payload.to_minute < 0 ||
    payload.to_minute > 59;

  if (isOutOfRange) {
    return { error: "Hours must be 0-23 and minutes must be 0-59." };
  }

  return { value: payload };
}

function formatScheduleEntry(entry: LightSchedule): string {
  return `${pad(entry.from_hour)}:${pad(entry.from_minute)} - ${pad(entry.to_hour)}:${pad(entry.to_minute)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
