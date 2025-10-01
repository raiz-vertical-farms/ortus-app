import { BleClient } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";

// BLE Service and Characteristic UUIDs (must match ESP32)
const BLE_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const BLE_CHAR_SSID_UUID = "12345678-1234-5678-1234-56789abcdef1";
const BLE_CHAR_PASSWORD_UUID = "12345678-1234-5678-1234-56789abcdef2";
const BLE_CHAR_STATUS_UUID = "12345678-1234-5678-1234-56789abcdef3";
const BLE_CHAR_MAC_UUID = "12345678-1234-5678-1234-56789abcdef4";
const BLE_CHAR_COMMAND_UUID = "12345678-1234-5678-1234-56789abcdef5";

interface ProvisioningCallbacks {
  onStatusUpdate?: (status: string) => void;
  onMacAddressReceived?: (mac: string) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class ESP32Provisioning {
  private deviceId: string | null = null;
  private callbacks: ProvisioningCallbacks;

  constructor(callbacks: ProvisioningCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    try {
      await BleClient.initialize();
      console.log("BLE initialized");
    } catch (error) {
      console.error("Failed to initialize BLE:", error);
      throw error;
    }
  }

  async scanForDevice(timeout: number = 5000): Promise<string | null> {
    try {
      const devices: any[] = [];

      await BleClient.requestLEScan(
        {
          services: [BLE_SERVICE_UUID],
        },
        (result) => {
          console.log("Found device:", result.device);
          if (result.device.name?.startsWith("Ortus-")) {
            devices.push(result.device);
          }
        }
      );

      // Stop scanning after timeout
      await new Promise((resolve) => setTimeout(resolve, timeout));
      await BleClient.stopLEScan();

      if (devices.length > 0) {
        // Return the first Ortus device found
        return devices[0].deviceId;
      }

      return null;
    } catch (error) {
      console.error("Scan error:", error);
      throw error;
    }
  }

  async connect(deviceId: string): Promise<void> {
    try {
      this.deviceId = deviceId;

      // Connect to device
      await BleClient.connect(deviceId, (disconnected) => {
        console.log("Device disconnected");
        this.deviceId = null;
        this.callbacks.onDisconnected?.();
      });

      console.log("Connected to device:", deviceId);
      this.callbacks.onConnected?.();

      // Start notifications for status updates
      await this.startStatusNotifications();

      // Start notifications for MAC address
      await this.startMacNotifications();
    } catch (error) {
      console.error("Connection error:", error);
      throw error;
    }
  }

  async provisionWiFi(ssid: string, password: string): Promise<string> {
    if (!this.deviceId) {
      throw new Error("Not connected to device");
    }

    try {
      // Convert strings to Uint8Array for BLE transmission
      const ssidData = this.stringToBytes(ssid);
      const passwordData = this.stringToBytes(password);

      // Send SSID
      await BleClient.write(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_SSID_UUID,
        ssidData
      );
      console.log("SSID sent:", ssid);

      // Small delay between writes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send Password
      await BleClient.write(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_PASSWORD_UUID,
        passwordData
      );
      console.log("Password sent");

      // Wait for connection result (up to 30 seconds)
      const macAddress = await this.waitForMacAddress(30000);

      return macAddress;
    } catch (error) {
      console.error("Provisioning error:", error);
      throw error;
    }
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.deviceId) {
      throw new Error("Not connected to device");
    }

    try {
      const commandData = this.stringToBytes(command);

      await BleClient.write(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_COMMAND_UUID,
        commandData
      );
      console.log("Command sent:", command);
    } catch (error) {
      console.error("Command error:", error);
      throw error;
    }
  }

  async readMacAddress(): Promise<string> {
    if (!this.deviceId) {
      throw new Error("Not connected to device");
    }

    try {
      const result = await BleClient.read(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_MAC_UUID
      );

      const macAddress = this.bytesToString(result);
      console.log("MAC address read:", macAddress);
      return macAddress;
    } catch (error) {
      console.error("Read MAC error:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.deviceId) {
      try {
        await BleClient.disconnect(this.deviceId);
        console.log("Disconnected from device");
        this.deviceId = null;
      } catch (error) {
        console.error("Disconnect error:", error);
      }
    }
  }

  private async startStatusNotifications(): Promise<void> {
    if (!this.deviceId) return;

    try {
      await BleClient.startNotifications(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_STATUS_UUID,
        (value) => {
          const status = this.bytesToString(value);
          console.log("Status update:", status);
          this.callbacks.onStatusUpdate?.(status);
        }
      );
    } catch (error) {
      console.error("Failed to start status notifications:", error);
    }
  }

  private async startMacNotifications(): Promise<void> {
    if (!this.deviceId) return;

    try {
      await BleClient.startNotifications(
        this.deviceId,
        BLE_SERVICE_UUID,
        BLE_CHAR_MAC_UUID,
        (value) => {
          const mac = this.bytesToString(value);
          console.log("MAC address notification:", mac);
          this.callbacks.onMacAddressReceived?.(mac);
        }
      );
    } catch (error) {
      console.error("Failed to start MAC notifications:", error);
    }
  }

  private async waitForMacAddress(timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("Timeout waiting for MAC address"));
        }
      }, timeout);

      // Override the callback temporarily
      const originalCallback = this.callbacks.onMacAddressReceived;
      this.callbacks.onMacAddressReceived = (mac: string) => {
        if (!resolved && mac && mac.length > 0) {
          resolved = true;
          clearTimeout(timeoutId);
          this.callbacks.onMacAddressReceived = originalCallback;
          originalCallback?.(mac);
          resolve(mac);
        }
      };
    });
  }

  private stringToBytes(str: string): DataView {
    const encoder = new TextEncoder();
    const array = encoder.encode(str);
    return new DataView(array.buffer);
  }

  private bytesToString(dataView: DataView): string {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(dataView);
  }
}

// Example usage
export async function provisionDevice(
  ssid: string,
  password: string
): Promise<string> {
  const provisioning = new ESP32Provisioning({
    onStatusUpdate: (status) => {
      console.log("Status:", status);
      // Update UI with status
    },
    onMacAddressReceived: (mac) => {
      console.log("MAC received:", mac);
      // Update UI with MAC
    },
    onConnected: () => {
      console.log("Connected to ESP32");
      // Update UI
    },
    onDisconnected: () => {
      console.log("Disconnected from ESP32");
      // Update UI
    },
    onError: (error) => {
      console.error("Error:", error);
      // Show error in UI
    },
  });

  try {
    // Initialize BLE
    await provisioning.initialize();

    // Scan for Ortus devices
    console.log("Scanning for devices...");
    const deviceId = await provisioning.scanForDevice(5000);

    if (!deviceId) {
      throw new Error("No Ortus device found");
    }

    // Connect to device
    console.log("Connecting to device...");
    await provisioning.connect(deviceId);

    // Send WiFi credentials and get MAC address
    console.log("Sending WiFi credentials...");
    const macAddress = await provisioning.provisionWiFi(ssid, password);

    console.log("Provisioning successful! MAC:", macAddress);

    // Optional: Send stop command to disable BLE on ESP32
    await provisioning.sendCommand("stop");

    // Disconnect
    await provisioning.disconnect();

    return macAddress;
  } catch (error) {
    console.error("Provisioning failed:", error);
    await provisioning.disconnect();
    throw error;
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
