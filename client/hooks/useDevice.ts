import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../lib/apiClient";

const DEFAULT_WS_PORT = 8765;

type DeviceState = typeof client.api.deviceState.types.data.state;

type ScheduleInput = {
  fromHours: number;
  fromMinutes: number;
  toHours: number;
  toMinutes: number;
  enabled?: boolean;
};

type PumpScheduleInput = {
  startHours: number;
  startMinutes: number;
  timesPerDay: number;
};

type UseDeviceResult = {
  state: DeviceState | null;
  isLoading: boolean;
  error: unknown;
  isWebSocketConnected: boolean;
  setBrightness: (value: number) => Promise<void>;
  toggleLightSchedule: (active: boolean) => Promise<void>;
  scheduleLights: (schedule: ScheduleInput) => Promise<void>;
  togglePumpSchedule: (
    active: boolean,
    scheduleOverride?: PumpScheduleInput
  ) => Promise<void>;
  schedulePump: (schedule: PumpScheduleInput) => Promise<void>;
  refresh: () => Promise<DeviceState | undefined>;
};

type WsStateMessage = {
  type: string;
  brightness?: number;
};

export function useDevice(deviceId: string): UseDeviceResult {
  const deviceQuery = client.api.deviceState.useQuery(
    { path: { id: deviceId } },
    { refetchInterval: 60000 }
  );

  const setBrightnessMutation = client.api.setBrightness.useMutation();
  const scheduleLightMutation = client.api.scheduleLight.useMutation();
  const schedulePumpMutation = client.api.schedulePump.useMutation();

  const [liveState, setLiveState] = useState<DeviceState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isWebSocketConnected, setIsWebSocketConnected] =
    useState<boolean>(false);
  const [wsReconnectToken, setWsReconnectToken] = useState<number>(0);

  useEffect(() => {
    if (deviceQuery.data?.state) {
      const latest = deviceQuery.data.state;
      setLiveState((current) => {
        if (!current) return latest;
        return {
          ...latest,
          ...current,
          light: current?.brightness ?? latest.brightness ?? null,
          light_schedule:
            current?.light_schedule ?? latest.light_schedule ?? null,
          pump_schedule:
            current?.pump_schedule ?? latest.pump_schedule ?? null,
        };
      });
    }
  }, [deviceQuery.data?.state]);

  const wsUrl = useMemo(() => {
    if (!deviceQuery.data?.state?.lan_ip) {
      return null;
    }
    const port = deviceQuery.data.state.lan_ws_port ?? DEFAULT_WS_PORT;
    return `ws://${deviceQuery.data.state.lan_ip}:${port}`;
  }, [deviceQuery.data?.state?.lan_ip, deviceQuery.data?.state?.lan_ws_port]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!wsUrl) {
      return;
    }

    let isMounted = true;
    let retryTimer: number | null = null;

    const requestReconnect = () => {
      if (retryTimer !== null) {
        return;
      }
      retryTimer = window.setTimeout(() => {
        setWsReconnectToken((token) => token + 1);
      }, 5000);
    };

    let socket: WebSocket;

    try {
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;
    } catch (error) {
      return;
    }

    socket.onopen = () => {
      if (!isMounted) {
        return;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      setIsWebSocketConnected(true);
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as WsStateMessage;
        if (parsed.type === "state") {
          setLiveState((prev) => {
            const base = prev ?? deviceQuery.data?.state ?? null;
            if (!base) return prev;

            const brightness =
              typeof parsed.brightness === "number"
                ? parsed.brightness
                : base?.brightness;

            return {
              ...base,
              brightness,
            };
          });
        }
      } catch (error) {
        console.warn("Failed to parse websocket message", error);
      }
    };

    socket.onclose = () => {
      if (!isMounted) {
        return;
      }
      setIsWebSocketConnected(false);
      socketRef.current = null;
      requestReconnect();
    };

    socket.onerror = () => {
      requestReconnect();
      socket.close();
    };

    return () => {
      isMounted = false;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      setIsWebSocketConnected(false);
      socketRef.current = null;
      socket.close();
    };
  }, [wsUrl, wsReconnectToken, deviceQuery.data?.state]);

  const sendOverWebSocket = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const setBrightness = useCallback(
    async (value: number) => {
      if (sendOverWebSocket({ type: "setBrightness", brightness: value })) {
        setLiveState((prev) => (prev ? { ...prev, light: value } : prev));
        return;
      }

      await setBrightnessMutation.mutateAsync({
        path: { id: deviceId },
        body: { brightness: value },
      });

      await deviceQuery.refetch();
    },
    [deviceId, deviceQuery, sendOverWebSocket, setBrightnessMutation]
  );

  const scheduleLights = useCallback(
    async (schedule: ScheduleInput) => {
      await scheduleLightMutation.mutateAsync({
        path: { id: deviceId },
        body: {
          on: getTimestampByHoursAndMinutes(
            schedule.fromHours,
            schedule.fromMinutes
          ),
          off: getTimestampByHoursAndMinutes(
            schedule.toHours,
            schedule.toMinutes
          ),
          active: true,
        },
      });

      setLiveState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          light_schedule: {
            active: true,
            on: getTimestampByHoursAndMinutes(
              schedule.fromHours,
              schedule.fromMinutes
            ),
            off: getTimestampByHoursAndMinutes(
              schedule.toHours,
              schedule.toMinutes
            ),
          },
        };
      });

      await deviceQuery.refetch();
    },
    [deviceId, deviceQuery, scheduleLightMutation, sendOverWebSocket]
  );

  const toggleLightSchedule = useCallback(
    async (active: boolean) => {
      try {
        await scheduleLightMutation.mutateAsync({
          path: { id: deviceId },
          body: { active },
        });

        setLiveState((prev) => {
          if (!prev) return prev;

          return {
            ...prev,
            light_schedule: prev.light_schedule
              ? { ...prev.light_schedule, active }
              : { active, on: 0, off: 0 },
          };
        });
      } catch (error) {
        console.error("Failed to toggle schedule:", error);
      }
    },
    [deviceId, scheduleLightMutation]
  );

  const schedulePump = useCallback(
    async (schedule: PumpScheduleInput) => {
      const startTime = getTimestampByHoursAndMinutes(
        schedule.startHours,
        schedule.startMinutes
      );

      await schedulePumpMutation.mutateAsync({
        path: { id: deviceId },
        body: {
          active: true,
          start_time: startTime,
          times_per_day: schedule.timesPerDay,
        },
      });

      setLiveState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pump_schedule: {
            active: true,
            start_time: startTime,
            times_per_day: schedule.timesPerDay,
          },
        };
      });

      await deviceQuery.refetch();
    },
    [deviceId, deviceQuery, schedulePumpMutation]
  );

  const togglePumpSchedule = useCallback(
    async (active: boolean, scheduleOverride?: PumpScheduleInput) => {
      if (active) {
        const fallbackSchedule = (() => {
          if (scheduleOverride) {
            return scheduleOverride;
          }
          const base =
            liveState?.pump_schedule ??
            deviceQuery.data?.state?.pump_schedule ??
            null;
          if (base) {
            const startDate = new Date(base.start_time || 0);
            return {
              startHours: startDate.getHours(),
              startMinutes: startDate.getMinutes(),
              timesPerDay: Math.max(1, base.times_per_day || 1),
            };
          }
          const now = new Date();
          return {
            startHours: now.getHours(),
            startMinutes: now.getMinutes(),
            timesPerDay: 1,
          };
        })();

        await schedulePump(fallbackSchedule);
        return;
      }

      try {
        await schedulePumpMutation.mutateAsync({
          path: { id: deviceId },
          body: { active: false },
        });

        setLiveState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pump_schedule: prev.pump_schedule
              ? { ...prev.pump_schedule, active: false }
              : { active: false, start_time: 0, times_per_day: 1 },
          };
        });
      } catch (error) {
        console.error("Failed to toggle pump schedule:", error);
      }
    },
    [
      deviceId,
      schedulePumpMutation,
      schedulePump,
      liveState?.pump_schedule?.start_time,
      liveState?.pump_schedule?.times_per_day,
      deviceQuery.data?.state?.pump_schedule?.start_time,
      deviceQuery.data?.state?.pump_schedule?.times_per_day,
    ]
  );

  const refresh = useCallback(async () => {
    const result = await deviceQuery.refetch();
    if (result.data?.state) {
      setLiveState(result.data.state as DeviceState);
      return result.data.state as DeviceState;
    }
    return undefined;
  }, [deviceQuery]);

  return {
    state:
      liveState ?? (deviceQuery.data?.state as DeviceState | undefined) ?? null,
    isLoading: deviceQuery.isLoading,
    error: deviceQuery.error,
    isWebSocketConnected,
    setBrightness,
    toggleLightSchedule,
    scheduleLights,
    togglePumpSchedule,
    schedulePump,
    refresh,
  };
}

function getTimestampByHoursAndMinutes(hours: number, minutes: number) {
  const now = new Date();
  now.setHours(hours);
  now.setMinutes(minutes);
  now.setSeconds(0);
  now.setMilliseconds(0);
  return now.getTime();
}
