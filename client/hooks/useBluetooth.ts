import { useState, useRef, useCallback, useEffect } from "react";
import {
  ESP32Provisioning,
  checkIfBluetoothIsSupported,
} from "../utils/bluetooth"; // export your class from the file above

export function useBluetooth() {
  const [isSupported, setIsSupported] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [macAddress, setMacAddress] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);
  const provisioningRef = useRef<ESP32Provisioning | null>(null);

  useEffect(() => {
    checkIfBluetoothIsSupported().then((supported) => {
      setIsSupported(supported);
    });
  }, []);

  // Initialize provisioning instance with callbacks
  useEffect(() => {
    if (isSupported) {
      provisioningRef.current = new ESP32Provisioning({
        onStatusUpdate: (s) => setStatus(s),
        onMacAddressReceived: (mac) => setMacAddress(mac),
        onConnected: () => setIsConnected(true),
        onDisconnected: () => setIsConnected(false),
        onError: (err) => setStatus(`Error: ${err.message}`),
      });
    }

    return () => {
      provisioningRef.current?.disconnect();
      provisioningRef.current = null;
    };
  }, [isSupported]);

  const initialize = useCallback(async () => {
    try {
      await provisioningRef.current?.initialize();
      setStatus("BLE initialized");
    } catch (err: any) {
      setStatus(`Init failed: ${err.message}`);
    }
  }, []);

  const scanAndConnect = useCallback(async () => {
    try {
      setStatus("Scanning for devices...");
      const deviceId = await provisioningRef.current?.scanForDevice(5000);
      if (!deviceId) {
        setStatus("No Ortus device found");
        return false;
      }
      setStatus("Connecting...");
      await provisioningRef.current?.connect(deviceId);
      return true;
    } catch (err: any) {
      setStatus(`Scan/connect error: ${err.message}`);
      return false;
    }
  }, []);

  const provisionWiFi = useCallback(async (ssid: string, password: string) => {
    if (!provisioningRef.current) return;
    try {
      setIsProvisioning(true);
      setStatus("Sending WiFi credentials...");
      const mac = await provisioningRef.current.provisionWiFi(ssid, password);
      setMacAddress(mac);
      setStatus("Provisioning successful!");
      return mac;
    } catch (err: any) {
      const message =
        (typeof err === "object" && err?.message) ||
        (typeof err === "string" ? err : "Unknown provisioning error");
      setStatus(`Provisioning failed: ${message}`);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsProvisioning(false);
    }
  }, []);

  const sendCommand = useCallback(async (command: string) => {
    try {
      await provisioningRef.current?.sendCommand(command);
      setStatus(`Command "${command}" sent`);
    } catch (err: any) {
      setStatus(`Command error: ${err.message}`);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await provisioningRef.current?.disconnect();
    setStatus("Disconnected");
  }, []);

  return {
    status,
    isSupported,
    macAddress,
    isConnected,
    isProvisioning,
    initialize,
    scanAndConnect,
    provisionWiFi,
    sendCommand,
    disconnect,
  };
}
