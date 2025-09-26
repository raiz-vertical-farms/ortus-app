import {
  BleClient,
  numberToUUID,
  ScanResult,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";

const HEART_RATE_SERVICE = numberToUUID(0x180d);

export async function initializeBluetooth() {
  try {
    await BleClient.initialize();
    console.log("Bluetooth initialized");
  } catch (error) {
    console.error("Error initializing Bluetooth:", error);
  }
}

export async function checkIfBluetoothIsSupported(): Promise<boolean> {
  try {
    const isSupported = Capacitor.isNativePlatform();
    console.log("Bluetooth supported:", isSupported);
    return isSupported;
  } catch (error) {
    console.error("Error checking Bluetooth support:", error);
    return false;
  }
}

export async function checkIfBluetoothIsEnabled(): Promise<boolean> {
  try {
    const isEnabled = await BleClient.isEnabled();
    return isEnabled;
  } catch (error) {
    console.error("Error checking Bluetooth status:", error);
    return false;
  }
}

export async function scan(
  onDeviceFound: (scanResult: ScanResult) => void
): Promise<void> {
  try {
    await BleClient.initialize();

    await BleClient.requestLEScan(
      {
        // Have the ESP do some sort of service like this:
        // services: [HEART_RATE_SERVICE],
      },
      (result) => {
        console.log("Received new scan result", result);
        onDeviceFound(result);
      }
    );

    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          await BleClient.stopLEScan();
          console.log("stopped scanning");
        } finally {
          resolve();
        }
      }, 5000);
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}
