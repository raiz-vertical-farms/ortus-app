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
      setStatus("BLE initialized");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Init failed";
      setStatus(`Init failed: ${message}`);
      throw err;
    }
  }, []);

  const scanForDevices = useCallback(async () => {
    try {
      setStatus("Scanning for devices...");
      const foundDevices = await scanForOrtusDevices(5000);
      setDevices(foundDevices);

      if (foundDevices.length === 0) {
        setStatus("No Ortus devices found");
      } else {
        setStatus(`Found ${foundDevices.length} device(s)`);
      }

      return foundDevices;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setStatus(`Scan error: ${message}`);
      throw err;
    }
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    try {
      setStatus("Connecting...");

      const connection = await connectToDevice(deviceId, {
        onStatusUpdate: (s) => setStatus(s),
        onMacAddressReceived: (mac) => setMacAddress(mac),
        onDisconnected: () => {
          setIsConnected(false);
          setSelectedDeviceId(null);
          connectionRef.current = null;
          setStatus("Disconnected");
        },
      });

      connectionRef.current = connection;
      setSelectedDeviceId(deviceId);
      setIsConnected(true);
      setStatus("Connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setStatus(`Connection error: ${message}`);
      setIsConnected(false);
      throw err;
    }
  }, []);

  const provision = useCallback(
    async (ssid: string, password: string) => {
      if (!connectionRef.current || !selectedDeviceId) {
        throw new Error("Not connected to device");
      }

      try {
        setIsProvisioning(true);
        setStatus("Sending WiFi credentials...");

        // Don't pass callbacks - they're already set up from connect()
        const mac = await provisionWiFiCore(
          connectionRef.current,
          ssid,
          password
        );

        setMacAddress(mac);
        setStatus("Provisioning successful!");
        return mac;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Provisioning failed";
        setStatus(`Provisioning failed: ${message}`);
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
        throw new Error("Not connected to device");
      }

      try {
        await sendCommandCore(connectionRef.current, command);
        setStatus(`Command "${command}" sent`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Command failed";
        setStatus(`Command error: ${message}`);
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
    setStatus("Disconnected");
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
