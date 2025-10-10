import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../lib/apiClient";

const DEFAULT_WS_PORT = 8765;

type ScheduleInput = {
  fromHours: number;
  fromMinutes: number;
  toHours: number;
  toMinutes: number;
  enabled?: boolean;
};

type DeviceLightSchedule = {
  from_hour: number;
  from_minute: number;
  to_hour: number;
  to_minute: number;
  enabled?: boolean;
};

type DeviceState = {
  id: number;
  name: string;
  mac_address: string;
  organization_id: number;
  last_seen: number | null;
  online: boolean;
  light: number | null;
  light_schedule: DeviceLightSchedule | null;
  water_level: string | null;
  number_of_plants: number;
  lan_ip: string | null;
  lan_ws_port: number | null;
};

type UseDeviceResult = {
  state: DeviceState | null;
  isLoading: boolean;
  error: unknown;
  isWebSocketConnected: boolean;
  setBrightness: (value: number) => Promise<void>;
  scheduleLights: (schedule: ScheduleInput) => Promise<void>;
  refresh: () => Promise<DeviceState | undefined>;
};

type WsStateMessage = {
  type: string;
  brightness?: number;
  schedule?: {
    enabled?: boolean;
    from_hour?: number;
    from_minute?: number;
    to_hour?: number;
    to_minute?: number;
  };
};

function mergeSchedule(
  current: DeviceLightSchedule | null,
  update?: WsStateMessage["schedule"] | null
): DeviceLightSchedule | null {
  if (!update) {
    return current;
  }

  const base: DeviceLightSchedule = current
    ? { ...current }
    : {
        from_hour: update.from_hour ?? 0,
        from_minute: update.from_minute ?? 0,
        to_hour: update.to_hour ?? 0,
        to_minute: update.to_minute ?? 0,
      };

  if (typeof update.from_hour === "number") {
    base.from_hour = update.from_hour;
  }
  if (typeof update.from_minute === "number") {
    base.from_minute = update.from_minute;
  }
  if (typeof update.to_hour === "number") {
    base.to_hour = update.to_hour;
  }
  if (typeof update.to_minute === "number") {
    base.to_minute = update.to_minute;
  }
  if (typeof update.enabled === "boolean") {
    base.enabled = update.enabled;
  }

  return base;
}

export function useDevice(deviceId: string): UseDeviceResult {
  const deviceQuery = client.api.deviceState.useQuery(
    { path: { id: deviceId } },
    { refetchInterval: 60000 }
  );

  const setLightMutation = client.api.setLight.useMutation();
  const scheduleLightMutation = client.api.scheduleLight.useMutation();

  const [liveState, setLiveState] = useState<DeviceState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isWebSocketConnected, setIsWebSocketConnected] =
    useState<boolean>(false);
  const [wsReconnectToken, setWsReconnectToken] = useState<number>(0);

  useEffect(() => {
    if (deviceQuery.data?.state) {
      const latest = deviceQuery.data.state as DeviceState;
      setLiveState((current) => {
        if (!current) {
          return latest;
        }

        return {
          ...latest,
          ...current,
          light: current.light ?? latest.light ?? null,
          light_schedule:
            current.light_schedule ?? latest.light_schedule ?? null,
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
            const base =
              prev ??
              (deviceQuery.data?.state as DeviceState | undefined) ??
              null;
            if (!base) {
              return null;
            }
            const light =
              typeof parsed.brightness === "number"
                ? parsed.brightness
                : base.light;

            const schedule = mergeSchedule(
              base.light_schedule,
              parsed.schedule
            );

            return {
              ...base,
              light,
              light_schedule: schedule,
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

      await setLightMutation.mutateAsync({
        path: { id: deviceId },
        body: { brightness: value },
      });

      await deviceQuery.refetch();
    },
    [deviceId, deviceQuery, sendOverWebSocket, setLightMutation]
  );

  const scheduleLights = useCallback(
    async (schedule: ScheduleInput) => {
      const payload = {
        type: "scheduleLights",
        schedule: {
          from_hour: schedule.fromHours,
          from_minute: schedule.fromMinutes,
          to_hour: schedule.toHours,
          to_minute: schedule.toMinutes,
          enabled: schedule.enabled ?? true,
        },
      };

      if (sendOverWebSocket(payload)) {
        setLiveState((prev) =>
          prev
            ? {
                ...prev,
                light_schedule: payload.schedule,
              }
            : prev
        );
        return;
      }

      await scheduleLightMutation.mutateAsync({
        path: { id: deviceId },
        body: {
          from_hour: schedule.fromHours,
          from_minute: schedule.fromMinutes,
          to_hour: schedule.toHours,
          to_minute: schedule.toMinutes,
        },
      });

      await deviceQuery.refetch();
    },
    [deviceId, deviceQuery, scheduleLightMutation, sendOverWebSocket]
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
    scheduleLights,
    refresh,
  };
}
