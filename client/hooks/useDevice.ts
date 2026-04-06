import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../lib/apiClient";
import { getClerkToken } from "../lib/apiClient";

const DEFAULT_WS_PORT = 8765;
const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "";

export type IntervalSchedule = {
  active: boolean;
  start_at: number;
  start_off: boolean;
  minutes_on: number;
  minutes_off: number;
};

export type DeviceState = {
  id: number;
  created_at: number;
  name: string;
  mac_address: string;
  last_seen: number | null;
  online: boolean;
  brightness: number | null;
  temperature: number | null;
  water_empty: boolean | null;
  light_schedule: IntervalSchedule | null;
  irrigation_schedule: IntervalSchedule | null;
  fan_schedule: IntervalSchedule | null;
  lan_ip: string | null;
  lan_ws_port: number | null;
};

export type PhaseInfo = {
  isOn: boolean;
  phaseEndsAt: number;
};

/** Computes the current ON/OFF phase and when it ends. */
export function computePhase(schedule: IntervalSchedule): PhaseInfo {
  const now = Date.now();
  const onMs = schedule.minutes_on * 60 * 1000;
  const offMs = schedule.minutes_off * 60 * 1000;
  const cycleMs = onMs + offMs;
  const elapsed = now - schedule.start_at;
  const phaseMs = ((elapsed % cycleMs) + cycleMs) % cycleMs;
  const cycleStart = now - phaseMs;

  if (schedule.start_off) {
    if (phaseMs < offMs) {
      return { isOn: false, phaseEndsAt: cycleStart + offMs };
    }
    return { isOn: true, phaseEndsAt: cycleStart + offMs + onMs };
  }

  if (phaseMs < onMs) {
    return { isOn: true, phaseEndsAt: cycleStart + onMs };
  }
  return { isOn: false, phaseEndsAt: cycleStart + onMs + offMs };
}

type ScheduleInput = {
  minutes_on?: number;
  minutes_off?: number;
};

type UseDeviceResult = {
  state: DeviceState | null;
  isLoading: boolean;
  error: unknown;
  isWebSocketConnected: boolean;
  setBrightness: (value: number) => Promise<void>;
  startLightSchedule: (opts?: ScheduleInput) => Promise<void>;
  pauseLightSchedule: () => Promise<void>;
  skipLightSchedule: () => Promise<void>;
  startIrrigationSchedule: (opts?: ScheduleInput) => Promise<void>;
  pauseIrrigationSchedule: () => Promise<void>;
  skipIrrigationSchedule: () => Promise<void>;
  startFanSchedule: (opts?: ScheduleInput) => Promise<void>;
  pauseFanSchedule: () => Promise<void>;
  skipFanSchedule: () => Promise<void>;
  refresh: () => Promise<DeviceState | undefined>;
};

type WsStateMessage = {
  brightness?: number;
  waterEmpty?: boolean;
};

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = await getClerkToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}

export function useDevice(deviceId: string): UseDeviceResult {
  const deviceQuery = client.api.deviceState.useQuery(
    { path: { id: deviceId } },
    { refetchInterval: 60000 }
  );

  const [liveState, setLiveState] = useState<DeviceState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const [wsReconnectToken, setWsReconnectToken] = useState(0);

  useEffect(() => {
    if (deviceQuery.data?.state) {
      const latest = deviceQuery.data.state as unknown as DeviceState;
      setLiveState((current) => {
        if (!current) return latest;
        // Preserve brightness for low-latency slider control; everything else comes from server.
        return { ...latest, brightness: current.brightness ?? latest.brightness };
      });
    }
  }, [deviceQuery.data?.state]);

  const wsUrl = useMemo(() => {
    if (!deviceQuery.data?.state?.lan_ip) return null;
    const port = deviceQuery.data.state.lan_ws_port ?? DEFAULT_WS_PORT;
    return `ws://${deviceQuery.data.state.lan_ip}:${port}`;
  }, [deviceQuery.data?.state?.lan_ip, deviceQuery.data?.state?.lan_ws_port]);

  useEffect(() => {
    if (typeof window === "undefined" || !wsUrl) return;

    let isMounted = true;
    let retryTimer: number | null = null;

    const requestReconnect = () => {
      if (retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        setWsReconnectToken((t) => t + 1);
      }, 5000);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;
    } catch {
      return;
    }

    socket.onopen = () => {
      if (!isMounted) return;
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
      setIsWebSocketConnected(true);
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as WsStateMessage;
        setLiveState((prev) => {
          const base = prev ?? (deviceQuery.data?.state as unknown as DeviceState) ?? null;
          if (!base) return prev;
          return {
            ...base,
            brightness: typeof parsed.brightness === "number" ? parsed.brightness : base.brightness,
            water_empty: typeof parsed.waterEmpty === "boolean" ? parsed.waterEmpty : base.water_empty,
          };
        });
      } catch {
        // ignore parse errors
      }
    };

    socket.onclose = () => {
      if (!isMounted) return;
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
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
      setIsWebSocketConnected(false);
      socketRef.current = null;
      socket.close();
    };
  }, [wsUrl, wsReconnectToken, deviceQuery.data?.state]);

  const sendOverWebSocket = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const setBrightness = useCallback(async (value: number) => {
    if (sendOverWebSocket({ type: "setBrightness", value })) {
      setLiveState((prev) => (prev ? { ...prev, brightness: value } : prev));
      return;
    }
    await apiFetch(`/api/device/${deviceId}/light/brightness`, {
      method: "POST",
      body: JSON.stringify({ brightness: value }),
    });
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery, sendOverWebSocket]);

  const startLightSchedule = useCallback(async (opts?: ScheduleInput) => {
    await apiFetch(`/api/device/${deviceId}/light/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: true, ...opts }),
    });
    setLiveState((prev) =>
      prev?.light_schedule ? { ...prev, light_schedule: { ...prev.light_schedule, active: true } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const pauseLightSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/light/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: false }),
    });
    setLiveState((prev) =>
      prev?.light_schedule ? { ...prev, light_schedule: { ...prev.light_schedule, active: false } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const skipLightSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/light/schedule/skip`, { method: "POST" });
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const startIrrigationSchedule = useCallback(async (opts?: ScheduleInput) => {
    await apiFetch(`/api/device/${deviceId}/irrigation/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: true, ...opts }),
    });
    setLiveState((prev) =>
      prev?.irrigation_schedule ? { ...prev, irrigation_schedule: { ...prev.irrigation_schedule, active: true } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const pauseIrrigationSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/irrigation/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: false }),
    });
    setLiveState((prev) =>
      prev?.irrigation_schedule ? { ...prev, irrigation_schedule: { ...prev.irrigation_schedule, active: false } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const skipIrrigationSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/irrigation/schedule/skip`, { method: "POST" });
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const startFanSchedule = useCallback(async (opts?: ScheduleInput) => {
    await apiFetch(`/api/device/${deviceId}/fan/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: true, ...opts }),
    });
    setLiveState((prev) =>
      prev?.fan_schedule ? { ...prev, fan_schedule: { ...prev.fan_schedule, active: true } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const pauseFanSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/fan/schedule`, {
      method: "POST",
      body: JSON.stringify({ active: false }),
    });
    setLiveState((prev) =>
      prev?.fan_schedule ? { ...prev, fan_schedule: { ...prev.fan_schedule, active: false } } : prev
    );
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const skipFanSchedule = useCallback(async () => {
    await apiFetch(`/api/device/${deviceId}/fan/schedule/skip`, { method: "POST" });
    await deviceQuery.refetch();
  }, [deviceId, deviceQuery]);

  const refresh = useCallback(async () => {
    const result = await deviceQuery.refetch();
    if (result.data?.state) {
      const state = result.data.state as unknown as DeviceState;
      setLiveState(state);
      return state;
    }
    return undefined;
  }, [deviceQuery]);

  return {
    state: liveState ?? (deviceQuery.data?.state as unknown as DeviceState | undefined) ?? null,
    isLoading: deviceQuery.isLoading,
    error: deviceQuery.error,
    isWebSocketConnected,
    setBrightness,
    startLightSchedule,
    pauseLightSchedule,
    skipLightSchedule,
    startIrrigationSchedule,
    pauseIrrigationSchedule,
    skipIrrigationSchedule,
    startFanSchedule,
    pauseFanSchedule,
    skipFanSchedule,
    refresh,
  };
}
