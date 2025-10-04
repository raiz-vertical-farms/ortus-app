import { useState, useCallback, useEffect, useRef } from "react";
import {
  initializeBLE,
  isBluetoothSupported,
  scanForOrtusDevices,
  connectToDevice,
  provisionWiFi as provisionWiFiCore,
  sendCommand as sendCommandCore,
  type OrtusDevice,
  type BLEConnection,
} from "../utils/bluetooth";

interface UseBluetoothReturn {
  // State
  status: string;
  isSupported: boolean;
  macAddress: string;
  isConnected: boolean;
  isProvisioning: boolean;
  devices: OrtusDevice[];
  selectedDeviceId: string | null;

  // Actions
  initialize: () => Promise<void>;
  scanForDevices: () => Promise<OrtusDevice[]>;
  connect: (deviceId: string) => Promise<void>;
  provision: (ssid: string, password: string) => Promise<string>;
  sendCommand: (command: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useBluetooth(): UseBluetoothReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [macAddress, setMacAddress] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);
  const [devices, setDevices] = useState<OrtusDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const connectionRef = useRef<BLEConnection | null>(null);

  // Check Bluetooth support on mount
  useEffect(() => {
    setIsSupported(isBluetoothSupported());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      connectionRef.current?.disconnect();
    };
  }, []);

  const initialize = useCallback(async () => {
    try {
      await initializeBLE();
      setStatus("Bluetooth is ready.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Bluetooth setup failed";
      setStatus(`Bluetooth setup failed: ${message}`);
      throw err;
    }
  }, []);

  const scanForDevices = useCallback(async () => {
    try {
      setStatus("Looking for nearby Ortus...");
      const foundDevices = await scanForOrtusDevices(5000);
      setDevices(foundDevices);

      if (foundDevices.length === 0) {
        setStatus("No Ortus spotted nearby.");
      } else {
        setStatus(
          foundDevices.length === 1
            ? "Found 1 Ortus"
            : `Found ${foundDevices.length} Ortus`
        );
      }

      return foundDevices;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setStatus(`Scan hiccup: ${message}`);
      throw err;
    }
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    try {
      setStatus("Connecting to your Ortus...");

      const connection = await connectToDevice(deviceId, {
        onStatusUpdate: (s) => setStatus(s),
        onMacAddressReceived: (mac) => setMacAddress(mac),
        onDisconnected: () => {
          setIsConnected(false);
          setSelectedDeviceId(null);
          connectionRef.current = null;
          setStatus("Bluetooth disconnected.");
        },
      });

      connectionRef.current = connection;
      setSelectedDeviceId(deviceId);
      setIsConnected(true);
      setStatus("Connected!");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Connection failed";
      setStatus(`Couldn't connect: ${message}`);
      setIsConnected(false);
      throw err;
    }
  }, []);

  const provision = useCallback(
    async (ssid: string, password: string) => {
      if (!connectionRef.current || !selectedDeviceId) {
        throw new Error("Not connected to an Ortus.");
      }

      try {
        setIsProvisioning(true);
        setStatus("Sending Wi-Fi details...");

        // Don't pass callbacks - they're already set up from connect()
        const mac = await provisionWiFiCore(
          connectionRef.current,
          ssid,
          password
        );

        setMacAddress(mac);
        setStatus("Wi-Fi shared successfully!");
        return mac;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Provisioning failed";
        setStatus(`Couldn't share Wi-Fi: ${message}`);
        throw err;
      } finally {
        setIsProvisioning(false);
      }
    },
    [selectedDeviceId]
  );

  const sendCommand = useCallback(
    async (command: string) => {
      if (!connectionRef.current || !selectedDeviceId) {
        throw new Error("Not connected to an Ortus.");
      }

      try {
        await sendCommandCore(connectionRef.current, command);
        setStatus(`Sent command: ${command}`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Command failed";
        setStatus(`Command hiccup: ${message}`);
        throw err;
      }
    },
    [selectedDeviceId]
  );

  const disconnect = useCallback(async () => {
    if (connectionRef.current) {
      await connectionRef.current.disconnect();
      connectionRef.current = null;
    }
    setIsConnected(false);
    setSelectedDeviceId(null);
    setStatus("Bluetooth disconnected.");
  }, []);

  return {
    status,
    isSupported,
    macAddress,
    isConnected,
    isProvisioning,
    devices,
    selectedDeviceId,
    initialize,
    scanForDevices,
    connect,
    provision,
    sendCommand,
    disconnect,
  };
}
