import { BleClient } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";

// BLE Service and Characteristic UUIDs
const BLE_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const BLE_CHAR_SSID_UUID = "12345678-1234-5678-1234-56789abcdef1";
const BLE_CHAR_PASSWORD_UUID = "12345678-1234-5678-1234-56789abcdef2";
const BLE_CHAR_STATUS_UUID = "12345678-1234-5678-1234-56789abcdef3";
const BLE_CHAR_MAC_UUID = "12345678-1234-5678-1234-56789abcdef4";
const BLE_CHAR_COMMAND_UUID = "12345678-1234-5678-1234-56789abcdef5";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

const encodeString = (value: string): Uint8Array<ArrayBuffer> =>
  textEncoder.encode(value) as Uint8Array<ArrayBuffer>;
const toDataView = (bytes: Uint8Array<ArrayBuffer>): DataView =>
  new DataView(bytes.buffer);

const bytesToString = (
  value: DataView | ArrayBuffer | Uint8Array | null | undefined
): string => {
  if (!value) {
    return "";
  }

  if (value instanceof DataView) {
    return textDecoder.decode(value);
  }

  if (value instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return textDecoder.decode(value as Uint8Array);
  }

  return "";
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

export type BluetoothImplementation = "capacitor" | "web" | "unsupported";

const isWebBluetoothAvailable = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.bluetooth !== "undefined";

export const getBluetoothImplementation = (): BluetoothImplementation => {
  if (Capacitor.isNativePlatform()) {
    return "capacitor";
  }

  if (isWebBluetoothAvailable()) {
    return "web";
  }

  return "unsupported";
};

export const isBluetoothSupported = (): boolean =>
  getBluetoothImplementation() !== "unsupported";

interface BluetoothAdapter {
  initialize: () => Promise<void>;
  scan: (timeoutMs?: number) => Promise<OrtusDevice[]>;
  connect: (
    deviceId: string,
    callbacks?: ProvisioningCallbacks
  ) => Promise<BLEConnection>;
  provision: (
    connection: BLEConnection,
    ssid: string,
    password: string,
    timeoutMs?: number
  ) => Promise<string>;
  sendCommand: (connection: BLEConnection, command: string) => Promise<void>;
  readMac: (connection: BLEConnection) => Promise<string>;
}

const startStatusNotificationsCapacitor = async (
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

const capacitorAdapter: BluetoothAdapter = {
  initialize: async () => {
    await BleClient.initialize();
    console.log("BLE initialized");
  },
  scan: async (timeoutMs: number = 5000) => {
    const devices: OrtusDevice[] = [];

    await BleClient.requestLEScan(
      { services: [BLE_SERVICE_UUID] },
      (result) => {
        if (result.device.name?.startsWith("Ortus")) {
          const device: OrtusDevice = {
            deviceId: result.device.deviceId,
            name: result.device.name,
          };

          if (!devices.some((d) => d.deviceId === device.deviceId)) {
            devices.push(device);
            console.log("Found device:", device);
          }
        }
      }
    );

    await delay(timeoutMs);
    await BleClient.stopLEScan();

    return devices;
  },
  connect: async (deviceId, callbacks = {}) => {
    let macResolver: ((mac: string) => void) | null = null;

    await BleClient.connect(deviceId, () => {
      console.log("Device disconnected");
      callbacks.onDisconnected?.();
    });

    console.log("Connected to device:", deviceId);

    await startStatusNotificationsCapacitor(deviceId, callbacks);

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
  },
  provision: async (connection, ssid, password, timeoutMs = 30000) => {
    const { deviceId, waitForMac } = connection;

    await BleClient.write(
      deviceId,
      BLE_SERVICE_UUID,
      BLE_CHAR_SSID_UUID,
      toDataView(encodeString(ssid))
    );
    console.log("SSID sent:", ssid);

    await delay(100);

    await BleClient.write(
      deviceId,
      BLE_SERVICE_UUID,
      BLE_CHAR_PASSWORD_UUID,
      toDataView(encodeString(password))
    );
    console.log("Password sent");

    const macAddress = await waitForMac(timeoutMs);
    return macAddress;
  },
  sendCommand: async (connection, command) => {
    await BleClient.write(
      connection.deviceId,
      BLE_SERVICE_UUID,
      BLE_CHAR_COMMAND_UUID,
      toDataView(encodeString(command))
    );
    console.log("Command sent:", command);
  },
  readMac: async (connection) => {
    const result = await BleClient.read(
      connection.deviceId,
      BLE_SERVICE_UUID,
      BLE_CHAR_MAC_UUID
    );
    const macAddress = bytesToString(result);
    console.log("MAC address read:", macAddress);
    return macAddress;
  },
};

interface MacResolver {
  timer: ReturnType<typeof setTimeout>;
  resolve: (mac: string) => void;
  reject: (error: Error) => void;
}

interface WebConnectionData {
  deviceId: string;
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
  ssidCharacteristic: BluetoothRemoteGATTCharacteristic;
  passwordCharacteristic: BluetoothRemoteGATTCharacteristic;
  statusCharacteristic: BluetoothRemoteGATTCharacteristic;
  macCharacteristic: BluetoothRemoteGATTCharacteristic;
  commandCharacteristic: BluetoothRemoteGATTCharacteristic;
  statusListener: EventListener;
  macListener: EventListener;
  disconnectListener: EventListener;
  macResolvers: MacResolver[];
}

const webDevices = new Map<string, BluetoothDevice>();
const webConnections = new Map<string, WebConnectionData>();

const requireWebConnection = (deviceId: string): WebConnectionData => {
  const connection = webConnections.get(deviceId);
  if (!connection) {
    throw new Error(
      "No active Web Bluetooth connection found. Please reconnect."
    );
  }
  return connection;
};

const cleanupWebConnection = async (deviceId: string) => {
  const connection = webConnections.get(deviceId);

  if (!connection) {
    return;
  }

  connection.statusCharacteristic.removeEventListener(
    "characteristicvaluechanged",
    connection.statusListener
  );
  connection.macCharacteristic.removeEventListener(
    "characteristicvaluechanged",
    connection.macListener
  );
  connection.device.removeEventListener(
    "gattserverdisconnected",
    connection.disconnectListener
  );

  await Promise.allSettled([
    connection.statusCharacteristic.stopNotifications(),
    connection.macCharacteristic.stopNotifications(),
  ]);

  const error = new Error("Bluetooth disconnected.");
  for (const resolver of connection.macResolvers.splice(0)) {
    clearTimeout(resolver.timer);
    resolver.reject(error);
  }

  if (connection.server.connected) {
    connection.server.disconnect();
  }

  webConnections.delete(deviceId);
};

const webAdapter: BluetoothAdapter = {
  initialize: async () => {
    if (!isWebBluetoothAvailable()) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    try {
      const availability = await navigator.bluetooth.getAvailability?.();
      if (availability === false) {
        throw new Error("Bluetooth radio is unavailable.");
      }
    } catch (error) {
      // Some browsers do not implement getAvailability; ignore.
    }
  },
  scan: async () => {
    if (!isWebBluetoothAvailable()) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    const requestDevice = async (
      options: RequestDeviceOptions
    ): Promise<BluetoothDevice | null> => {
      try {
        return await navigator.bluetooth.requestDevice(options);
      } catch (error) {
        if (
          typeof DOMException !== "undefined" &&
          error instanceof DOMException &&
          error.name === "NotFoundError"
        ) {
          return null;
        }

        throw error;
      }
    };

    let device = await requestDevice({
      filters: [{ namePrefix: "Ortus" }],
      optionalServices: [BLE_SERVICE_UUID],
    });

    if (!device) {
      return [];
    }

    webDevices.set(device.id, device);

    return [
      {
        deviceId: device.id,
        name: device.name ?? "Ortus",
      },
    ];
  },
  connect: async (deviceId, callbacks = {}) => {
    if (!isWebBluetoothAvailable()) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    const device = webDevices.get(deviceId);
    if (!device) {
      throw new Error("Device not found. Please scan for your Ortus again.");
    }

    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error("Failed to connect to the device's GATT server.");
    }

    const service = await server.getPrimaryService(BLE_SERVICE_UUID);

    const [
      ssidCharacteristic,
      passwordCharacteristic,
      statusCharacteristic,
      macCharacteristic,
      commandCharacteristic,
    ] = await Promise.all([
      service.getCharacteristic(BLE_CHAR_SSID_UUID),
      service.getCharacteristic(BLE_CHAR_PASSWORD_UUID),
      service.getCharacteristic(BLE_CHAR_STATUS_UUID),
      service.getCharacteristic(BLE_CHAR_MAC_UUID),
      service.getCharacteristic(BLE_CHAR_COMMAND_UUID),
    ]);

    const macResolvers: MacResolver[] = [];

    const deliverMac = (mac: string) => {
      callbacks.onMacAddressReceived?.(mac);
      const pending = macResolvers.shift();
      if (pending) {
        pending.resolve(mac);
      }
    };

    const statusListener: EventListener = (event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const status = bytesToString(target.value ?? null);
      if (status) {
        console.log("Status update:", status);
        callbacks.onStatusUpdate?.(status);
      }
    };

    await statusCharacteristic.startNotifications();
    statusCharacteristic.addEventListener(
      "characteristicvaluechanged",
      statusListener
    );

    const macListener: EventListener = (event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const mac = bytesToString(target.value ?? null);
      if (mac) {
        console.log("MAC address received:", mac);
        deliverMac(mac);
      }
    };

    await macCharacteristic.startNotifications();
    macCharacteristic.addEventListener(
      "characteristicvaluechanged",
      macListener
    );

    const disconnectListener: EventListener = () => {
      callbacks.onDisconnected?.();
      cleanupWebConnection(deviceId).catch((error) => {
        console.error("Error during Web Bluetooth cleanup:", error);
      });
    };

    device.addEventListener("gattserverdisconnected", disconnectListener);

    const connectionData: WebConnectionData = {
      deviceId,
      device,
      server,
      service,
      ssidCharacteristic,
      passwordCharacteristic,
      statusCharacteristic,
      macCharacteristic,
      commandCharacteristic,
      statusListener,
      macListener,
      disconnectListener,
      macResolvers,
    };

    webConnections.set(deviceId, connectionData);

    callbacks.onStatusUpdate?.("Connected!");

    const waitForMac = (timeoutMs: number): Promise<string> =>
      new Promise((resolvePromise, rejectPromise) => {
        const entry: MacResolver = {
          timer: setTimeout(() => {
            const index = macResolvers.indexOf(entry);
            if (index >= 0) {
              macResolvers.splice(index, 1);
            }
            rejectPromise(new Error("Timed out waiting for the device ID."));
          }, timeoutMs),
          resolve: (mac) => {
            clearTimeout(entry.timer);
            resolvePromise(mac);
          },
          reject: (error) => {
            clearTimeout(entry.timer);
            rejectPromise(error);
          },
        };

        macResolvers.push(entry);
      });

    const disconnect = async () => {
      await cleanupWebConnection(deviceId);
    };

    return { deviceId, disconnect, waitForMac };
  },
  provision: async (connection, ssid, password, timeoutMs = 30000) => {
    const data = requireWebConnection(connection.deviceId);

    await data.ssidCharacteristic.writeValue(encodeString(ssid));
    console.log("SSID sent:", ssid);

    await delay(100);

    await data.passwordCharacteristic.writeValue(encodeString(password));
    console.log("Password sent");

    return connection.waitForMac(timeoutMs);
  },
  sendCommand: async (connection, command) => {
    const data = requireWebConnection(connection.deviceId);
    await data.commandCharacteristic.writeValue(encodeString(command));
    console.log("Command sent:", command);
  },
  readMac: async (connection) => {
    const data = requireWebConnection(connection.deviceId);
    const value = await data.macCharacteristic.readValue();
    const macAddress = bytesToString(value);
    console.log("MAC address read:", macAddress);
    return macAddress;
  },
};

const requireAdapter = (): BluetoothAdapter => {
  const implementation = getBluetoothImplementation();

  if (implementation === "capacitor") {
    return capacitorAdapter;
  }

  if (implementation === "web") {
    return webAdapter;
  }

  throw new Error("Bluetooth is not supported in this environment.");
};

export const initializeBLE = async (): Promise<void> => {
  const adapter = requireAdapter();
  await adapter.initialize();
};

export const scanForOrtusDevices = async (
  timeoutMs?: number
): Promise<OrtusDevice[]> => {
  const adapter = requireAdapter();
  return adapter.scan(timeoutMs);
};

export const connectToDevice = async (
  deviceId: string,
  callbacks?: ProvisioningCallbacks
): Promise<BLEConnection> => {
  const adapter = requireAdapter();
  return adapter.connect(deviceId, callbacks);
};

export const provisionWiFi = async (
  connection: BLEConnection,
  ssid: string,
  password: string,
  timeoutMs?: number
): Promise<string> => {
  const adapter = requireAdapter();
  return adapter.provision(connection, ssid, password, timeoutMs);
};

export const sendCommand = async (
  connection: BLEConnection,
  command: string
): Promise<void> => {
  const adapter = requireAdapter();
  await adapter.sendCommand(connection, command);
};

export const readMacAddress = async (
  connection: BLEConnection
): Promise<string> => {
  const adapter = requireAdapter();
  return adapter.readMac(connection);
};

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
