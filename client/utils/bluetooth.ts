import {
  BleClient,
  ScanResult,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";

// Improv Wi-Fi Service UUID
const IMPROV_SERVICE = "00004677-0000-1000-8000-00805f9b34fb";

// Improv Characteristics
const CHAR_STATE = "00467768-6228-2272-4663-277478268001";
const CHAR_RPC_COMMAND = "00467768-6228-2272-4663-277478268003";
const CHAR_RPC_RESULT = "00467768-6228-2272-4663-277478268004";

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

export async function provisionDevice(
  deviceId: string,
  ssid: string,
  password: string
) {
  await connectToDevice(deviceId);
  await subscribeToImprov(deviceId);
  await sendWifiCredentials(deviceId, ssid, password);
}

export async function scan(
  onDeviceFound: (scanResult: ScanResult) => void
): Promise<void> {
  try {
    await BleClient.initialize();

    await BleClient.requestLEScan(
      {
        // services: [IMPROV_SERVICE],
      },
      (result) => {
        console.log("Found Improv device:", result);
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

export async function connectToDevice(deviceId: string) {
  await BleClient.connect(deviceId, (id) => {
    console.log(`Device ${id} disconnected`);
  });

  console.log("Connected to", deviceId);
  return deviceId;
}

export async function subscribeToImprov(deviceId: string) {
  await BleClient.startNotifications(
    deviceId,
    IMPROV_SERVICE,
    CHAR_STATE,
    (value) => {
      console.log("Improv state:", value.getUint8(0));
    }
  );

  await BleClient.startNotifications(
    deviceId,
    IMPROV_SERVICE,
    CHAR_RPC_RESULT,
    (value) => {
      const resultBytes = new Uint8Array(value.buffer);
      console.log("Improv RPC result:", resultBytes);
    }
  );
}

export function makeImprovPayload(ssid: string, password: string): DataView {
  const enc = new TextEncoder();
  const ssidBytes = Array.from(enc.encode(ssid));
  const pwdBytes = Array.from(enc.encode(password));

  // Data block: [ssid_len, ssid..., pwd_len, pwd...]
  const data = [ssidBytes.length, ...ssidBytes, pwdBytes.length, ...pwdBytes];

  const commandId = 0x01;
  const arr = [commandId, data.length, ...data];

  // checksum = sum(data) mod 256
  const checksum = data.reduce((s, b) => (s + b) & 0xff, 0);
  arr.push(checksum);

  return numbersToDataView(arr);
}

async function sendWifiCredentials(
  deviceId: string,
  ssid: string,
  password: string
) {
  const payload = makeImprovPayload(ssid, password);

  // Split into 20-byte chunks because BLE write limit
  const chunkSize = 20;
  for (let i = 0; i < payload.byteLength; i += chunkSize) {
    const chunk = new DataView(payload.buffer.slice(i, i + chunkSize));
    await BleClient.write(deviceId, IMPROV_SERVICE, CHAR_RPC_COMMAND, chunk);
  }

  console.log("Wi-Fi credentials sent");
}
