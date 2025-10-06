#include "ble_provisioning.h"

namespace
{
    constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000; // 30s window for Wi-Fi connect feedback
}

BluetoothProvisioning::BluetoothProvisioning(WiFiCredentialsStore &credentialsStore, NetworkManager &networkManager)
    : credentials(credentialsStore), network(networkManager),
      pServer(nullptr), pService(nullptr),
      pCharSSID(nullptr), pCharPassword(nullptr), pCharStatus(nullptr), pCharMAC(nullptr), pCharCommand(nullptr),
      pStatusDescriptor(nullptr), pMacDescriptor(nullptr),
      statusNotifyPending(false), macNotifyPending(false),
      awaitingWiFiConnection(false), lastWifiConnected(false), provisionSawDisconnect(false),
      wifiConnectionStart(0), wifiReconnectRequested(false),
      bleActive(false), deviceConnected(false), lastActivityTime(0)
{
}

void BluetoothProvisioning::begin()
{
    BLEDevice::init("Ortus-Provisioning");
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(this);

    pService = pServer->createService(BLE_SERVICE_UUID);

    pCharSSID = pService->createCharacteristic(BLE_CHAR_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharSSID->setCallbacks(this);

    pCharPassword = pService->createCharacteristic(BLE_CHAR_PASSWORD_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharPassword->setCallbacks(this);

    pCharStatus = pService->createCharacteristic(BLE_CHAR_STATUS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharStatus->addDescriptor(new BLE2902());
    pStatusDescriptor = (BLE2902 *)pCharStatus->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));

    pCharMAC = pService->createCharacteristic(
        BLE_CHAR_MAC_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharMAC->addDescriptor(new BLE2902());
    pMacDescriptor = (BLE2902 *)pCharMAC->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));

    pCharCommand = pService->createCharacteristic(BLE_CHAR_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharCommand->setCallbacks(this);

    pService->start();
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    BLEDevice::startAdvertising();

    bleActive = true;
    lastActivityTime = millis();

    updateMACAddress();
    updateStatus("BLE started");

    lastWifiConnected = (WiFi.status() == WL_CONNECTED);
}

void BluetoothProvisioning::checkAutoStop()
{
    flushPendingNotifications();

    if (wifiReconnectRequested)
    {
        wifiReconnectRequested = false;
        connectWithCredentials();
    }

    const bool wifiConnectedNow = (WiFi.status() == WL_CONNECTED);

    if (awaitingWiFiConnection)
    {
        if (!wifiConnectedNow)
        {
            provisionSawDisconnect = true;
        }
        else if (provisionSawDisconnect || !lastWifiConnected)
        {
            awaitingWiFiConnection = false;
            provisionSawDisconnect = false;
            updateStatus("Provisioning successful");
            updateMACAddress();
        }
        if (awaitingWiFiConnection && millis() - wifiConnectionStart >= WIFI_CONNECT_TIMEOUT_MS)
        {
            awaitingWiFiConnection = false;
            provisionSawDisconnect = false;
            updateStatus("Provisioning failed");
        }
    }
    else if (wifiConnectedNow && !lastWifiConnected)
    {
        updateStatus("WiFi connected");
        updateMACAddress();
    }

    if (!wifiConnectedNow && lastWifiConnected)
    {
        updateStatus("WiFi disconnected");
    }

    lastWifiConnected = wifiConnectedNow;

    // Keep BLE provisioning always available; restart advertising if needed.
    if (!bleActive)
    {
        BLEDevice::startAdvertising();
        bleActive = true;
        updateStatus("BLE advertising resumed");
    }
}

void BluetoothProvisioning::onConnect(BLEServer *pServer)
{
    deviceConnected = true;
    lastActivityTime = millis();

    if (pStatusDescriptor)
    {
        pStatusDescriptor->setNotifications(false);
    }
    if (pMacDescriptor)
    {
        pMacDescriptor->setNotifications(false);
    }
    awaitingWiFiConnection = false;
    provisionSawDisconnect = false;
    lastWifiConnected = (WiFi.status() == WL_CONNECTED);
    updateStatus("Device connected");
    updateMACAddress();
}

void BluetoothProvisioning::onDisconnect(BLEServer *pServer)
{
    deviceConnected = false;
    updateStatus("Device disconnected");
    awaitingWiFiConnection = false;
    provisionSawDisconnect = false;
    if (pStatusDescriptor)
    {
        pStatusDescriptor->setNotifications(false);
    }
    if (pMacDescriptor)
    {
        pMacDescriptor->setNotifications(false);
    }
    BLEDevice::startAdvertising();
}

void BluetoothProvisioning::onWrite(BLECharacteristic *pCharacteristic)
{
    lastActivityTime = millis();

    if (pCharacteristic == pCharSSID)
    {
        tempSSID = pCharacteristic->getValue().c_str();
        updateStatus("SSID received");
    }
    else if (pCharacteristic == pCharPassword)
    {
        tempPassword = pCharacteristic->getValue().c_str();
        updateStatus("Password received");
        credentials.save(tempSSID, tempPassword);
        wifiReconnectRequested = true;
    }
    else if (pCharacteristic == pCharCommand)
    {
        String command = pCharacteristic->getValue().c_str();
        processCommand(command);
    }
}

void BluetoothProvisioning::onRead(BLECharacteristic *pCharacteristic)
{
    lastActivityTime = millis();
}

void BluetoothProvisioning::updateStatus(const String &status)
{
    if (pCharStatus)
    {
        pCharStatus->setValue(status.c_str());
        if (canNotify(pStatusDescriptor))
        {
            pCharStatus->notify();
            statusNotifyPending = false;
        }
        else
        {
            statusNotifyPending = true;
        }
    }
    Serial.println("[BLE] " + status);
}

void BluetoothProvisioning::updateMACAddress()
{
    if (pCharMAC)
    {
        String mac = WiFi.macAddress();
        pCharMAC->setValue(mac.c_str());
        if (canNotify(pMacDescriptor))
        {
            pCharMAC->notify();
            macNotifyPending = false;
        }
        else
        {
            macNotifyPending = true;
        }
        Serial.print("[BLE] MAC ready: ");
        Serial.println(mac);
    }
}

bool BluetoothProvisioning::connectWithCredentials()
{
    awaitingWiFiConnection = true;
    wifiConnectionStart = millis();
    provisionSawDisconnect = (WiFi.status() != WL_CONNECTED);
    updateStatus("Provisioning WiFi...");
    network.forceReconnect();
    return true;
}

void BluetoothProvisioning::processCommand(const String &command)
{
    if (command == "STOP")
    {
        Serial.println("[BLE] STOP command received but ignored; BLE stays active");
        updateStatus("BLE remains active");
    }
}

void BluetoothProvisioning::flushPendingNotifications()
{
    if (statusNotifyPending && pCharStatus && canNotify(pStatusDescriptor))
    {
        pCharStatus->notify();
        statusNotifyPending = false;
    }

    if (macNotifyPending && pCharMAC && canNotify(pMacDescriptor))
    {
        pCharMAC->notify();
        macNotifyPending = false;
    }
}

bool BluetoothProvisioning::canNotify(BLE2902 *descriptor) const
{
    if (!deviceConnected || descriptor == nullptr)
    {
        return false;
    }

    return descriptor->getNotifications();
}
