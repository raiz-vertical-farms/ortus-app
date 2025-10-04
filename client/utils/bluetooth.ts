import { BleClient } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";

// BLE Service and Characteristic UUIDs
const BLE_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const BLE_CHAR_SSID_UUID = "12345678-1234-5678-1234-56789abcdef1";
const BLE_CHAR_PASSWORD_UUID = "12345678-1234-5678-1234-56789abcdef2";
const BLE_CHAR_STATUS_UUID = "12345678-1234-5678-1234-56789abcdef3";
const BLE_CHAR_MAC_UUID = "12345678-1234-5678-1234-56789abcdef4";
const BLE_CHAR_COMMAND_UUID = "12345678-1234-5678-1234-56789abcdef5";

// Types
export interface OrtusDevice {
  deviceId: string;
  name: string;
}

export interface BLEConnection {
  deviceId: string;
  disconnect: () => Promise<void>;
  waitForMac: (timeoutMs: number) => Promise<string>;
}

export interface ProvisioningCallbacks {
  onStatusUpdate?: (status: string) => void;
  onMacAddressReceived?: (mac: string) => void;
  onDisconnected?: () => void;
}

// Utility functions
const stringToBytes = (str: string): DataView => {
  const encoder = new TextEncoder();
  const array = encoder.encode(str);
  return new DataView(array.buffer);
};

const bytesToString = (dataView: DataView): string => {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(dataView);
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Initialize BLE
export const initializeBLE = async (): Promise<void> => {
  await BleClient.initialize();
  console.log("BLE initialized");
};

// Check Bluetooth support and status
export const isBluetoothSupported = (): boolean => Capacitor.isNativePlatform();

export const isBluetoothEnabled = async (): Promise<boolean> => {
  try {
    return await BleClient.isEnabled();
  } catch (error) {
    console.error("Error checking Bluetooth status:", error);
    return false;
  }
};

// Scan for Ortus devices
export const scanForOrtusDevices = async (
  timeoutMs: number = 5000
): Promise<OrtusDevice[]> => {
  const devices: OrtusDevice[] = [];

  await BleClient.requestLEScan({ services: [BLE_SERVICE_UUID] }, (result) => {
    if (result.device.name?.startsWith("Ortus")) {
      const device: OrtusDevice = {
        deviceId: result.device.deviceId,
        name: result.device.name,
      };

      // Avoid duplicates
      if (!devices.some((d) => d.deviceId === device.deviceId)) {
        devices.push(device);
        console.log("Found device:", device);
      }
    }
  });

  await delay(timeoutMs);
  await BleClient.stopLEScan();

  return devices;
};

// Connect to device
export const connectToDevice = async (
  deviceId: string,
  callbacks: ProvisioningCallbacks = {}
): Promise<BLEConnection> => {
  let macResolver: ((mac: string) => void) | null = null;

  await BleClient.connect(deviceId, () => {
    console.log("Device disconnected");
    callbacks.onDisconnected?.();
  });

  console.log("Connected to device:", deviceId);

  // Start notifications
  await startStatusNotifications(deviceId, callbacks);

  // Start MAC notifications once
  await BleClient.startNotifications(
    deviceId,
    BLE_SERVICE_UUID,
    BLE_CHAR_MAC_UUID,
    (value) => {
      const mac = bytesToString(value);
      console.log("MAC address received:", mac);
      callbacks.onMacAddressReceived?.(mac);
      macResolver?.(mac);
    }
  );

  const waitForMac = (timeoutMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      macResolver = resolve;

      setTimeout(() => {
        reject(new Error("Timed out waiting for the device ID."));
        macResolver = null;
      }, timeoutMs);
    });

  const disconnect = async () => {
    try {
      await BleClient.disconnect(deviceId);
      console.log("Disconnected from device");
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  };

  return { deviceId, disconnect, waitForMac };
};

// Start status notifications
const startStatusNotifications = async (
  deviceId: string,
  callbacks: ProvisioningCallbacks
): Promise<void> => {
  try {
    await BleClient.startNotifications(
      deviceId,
      BLE_SERVICE_UUID,
      BLE_CHAR_STATUS_UUID,
      (value) => {
        const status = bytesToString(value);
        console.log("Status update:", status);
        callbacks.onStatusUpdate?.(status);
      }
    );
  } catch (error) {
    console.error("Failed to start status notifications:", error);
  }
};

// Provision WiFi
export const provisionWiFi = async (
  connection: BLEConnection,
  ssid: string,
  password: string,
  timeoutMs: number = 30000
): Promise<string> => {
  const { deviceId, waitForMac } = connection;

  // Send SSID
  await BleClient.write(
    deviceId,
    BLE_SERVICE_UUID,
    BLE_CHAR_SSID_UUID,
    stringToBytes(ssid)
  );
  console.log("SSID sent:", ssid);

  await delay(100);

  // Send Password
  await BleClient.write(
    deviceId,
    BLE_SERVICE_UUID,
    BLE_CHAR_PASSWORD_UUID,
    stringToBytes(password)
  );
  console.log("Password sent");

  // Wait for MAC address
  const macAddress = await waitForMac(timeoutMs);
  return macAddress;
};

// Send command
export const sendCommand = async (
  connection: BLEConnection,
  command: string
): Promise<void> => {
  await BleClient.write(
    connection.deviceId,
    BLE_SERVICE_UUID,
    BLE_CHAR_COMMAND_UUID,
    stringToBytes(command)
  );
  console.log("Command sent:", command);
};

// Read MAC address
export const readMacAddress = async (
  connection: BLEConnection
): Promise<string> => {
  const result = await BleClient.read(
    connection.deviceId,
    BLE_SERVICE_UUID,
    BLE_CHAR_MAC_UUID
  );
  const macAddress = bytesToString(result);
  console.log("MAC address read:", macAddress);
  return macAddress;
};

// Complete provisioning flow (convenience function)
export const completeProvisioning = async (
  ssid: string,
  password: string,
  callbacks: ProvisioningCallbacks = {}
): Promise<string> => {
  await initializeBLE();

  const devices = await scanForOrtusDevices(5000);

  if (devices.length === 0) {
    throw new Error("Couldn't find an Ortus nearby.");
  }

  const connection = await connectToDevice(devices[0].deviceId, callbacks);

  try {
    const macAddress = await provisionWiFi(connection, ssid, password);
    await connection.disconnect();
    return macAddress;
  } catch (error) {
    await connection.disconnect();
    throw error;
  }
};
