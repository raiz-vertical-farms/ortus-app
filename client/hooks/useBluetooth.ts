import { useEffect, useState } from "react";
import {
  checkIfBluetoothIsEnabled,
  scan,
  initializeBluetooth,
  checkIfBluetoothIsSupported,
} from "../utils/bluetooth";
import { ScanResult } from "@capacitor-community/bluetooth-le";
import { set } from "zod/v4";

export function useBluetooth() {
  const [devices, setDevices] = useState<ScanResult[]>([]);
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    checkIfBluetoothIsSupported().then((supported) => {
      setIsSupported(supported);
    });
  }, []);

  async function checkEnabled() {
    await initializeBluetooth();
    const isEnabled = await checkIfBluetoothIsEnabled();
    setIsEnabled(isEnabled);
    return isEnabled;
  }

  async function startScan() {
    const isEnabled = await checkEnabled();
    if (!isEnabled) {
      console.log("Bluetooth is not enabled");
      return;
    }

    setIsScanning(true);
    setDevices([]);

    await scan((result) => {
      console.log("Received new scan result", result);
      setDevices((prevDevices) => {
        const exists = prevDevices.find(
          (d) => d.device.deviceId === result.device.deviceId
        );
        if (exists) {
          return prevDevices.map((d) =>
            d.device.deviceId === result.device.deviceId ? result : d
          );
        } else {
          return [...prevDevices, result];
        }
      });
    });

    setIsScanning(false);
  }

  return { startScan, isEnabled, devices, isSupported, isScanning };
}
