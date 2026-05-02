#include "ble_provisioning.h"
#include "config.h"
#include <WiFi.h>

BluetoothProvisioning::BluetoothProvisioning()
    : pServer(nullptr), pCharSSID(nullptr), pCharPassword(nullptr),
      pCharStatus(nullptr), pCharMAC(nullptr), pCharCommand(nullptr),
      pStatusDescriptor(nullptr), pMacDescriptor(nullptr),
      deviceConnected(false), oldDeviceConnected(false),
      statusNotifyPending(false), macNotifyPending(false)
{
}

void BluetoothProvisioning::begin(CredentialsCallback onCreds, VoidCallback onRec)
{
    onCredentials = onCreds;
    onReconnect = onRec;

    Serial.println("[BLE] Initializing BLE device...");
    BLEDevice::init("Ortus");
    Serial.println("[BLE] Device initialized, name='Ortus'");

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(this);
    Serial.println("[BLE] Server created");

    BLEService *pService = pServer->createService(BLE_SERVICE_UUID);
    Serial.print("[BLE] Service created, UUID=");
    Serial.println(BLE_SERVICE_UUID);

    pCharSSID = pService->createCharacteristic(BLE_CHAR_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharSSID->setCallbacks(this);

    pCharPassword = pService->createCharacteristic(BLE_CHAR_PASSWORD_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharPassword->setCallbacks(this);

    pCharStatus = pService->createCharacteristic(BLE_CHAR_STATUS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharStatus->addDescriptor(new BLE2902());
    pStatusDescriptor = (BLE2902 *)pCharStatus->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));

    pCharMAC = pService->createCharacteristic(BLE_CHAR_MAC_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharMAC->addDescriptor(new BLE2902());
    pMacDescriptor = (BLE2902 *)pCharMAC->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));

    pCharCommand = pService->createCharacteristic(BLE_CHAR_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
    pCharCommand->setCallbacks(this);

    Serial.println("[BLE] All 5 characteristics created (SSID, Password, Status, MAC, Command)");

    pService->start();
    Serial.println("[BLE] Service started");

    // Build explicit advertising data: Flags + Service UUID (21 bytes, fits in 31)
    BLEAdvertisementData advData;
    advData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
    advData.setCompleteServices(BLEUUID(BLE_SERVICE_UUID));

    // Build explicit scan response: Device name (7 bytes, fits in 31)
    BLEAdvertisementData scanData;
    scanData.setName("Ortus");

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->setAdvertisementData(advData);
    pAdvertising->setScanResponse(true);
    pAdvertising->setScanResponseData(scanData);

    BLEDevice::startAdvertising();

    Serial.println("[BLE] === Advertising Configuration ===");
    Serial.println("[BLE]   Adv packet: Flags(0x06) + Service UUID");
    Serial.println("[BLE]   Scan response: Name='Ortus'");
    Serial.println("[BLE]   Flags: LE General Discoverable + BR/EDR Not Supported");
    Serial.print("[BLE]   Service UUID: ");
    Serial.println(BLE_SERVICE_UUID);
    Serial.println("[BLE] === Advertising STARTED ===");

    updateStatus("BLE Ready");
    updateMACAddress();
    Serial.println("[BLE] Init complete. Waiting for connections...");
}

void BluetoothProvisioning::loop()
{
    if (!deviceConnected && oldDeviceConnected)
    {
        Serial.println("[BLE] Client disconnected. Restarting advertising in 500ms...");
        delay(500);
        pServer->startAdvertising();
        oldDeviceConnected = deviceConnected;
        updateStatus("Disconnected");
        Serial.println("[BLE] Advertising restarted after disconnect");
    }

    if (deviceConnected && !oldDeviceConnected)
    {
        Serial.println("[BLE] Client connected!");
        oldDeviceConnected = deviceConnected;
        updateStatus("Connected");
        updateMACAddress();
    }

    if (statusNotifyPending && canNotify(pStatusDescriptor))
    {
        pCharStatus->notify();
        statusNotifyPending = false;
        Serial.println("[BLE] Delivered pending status notification");
    }
    if (macNotifyPending && canNotify(pMacDescriptor))
    {
        pCharMAC->notify();
        macNotifyPending = false;
        Serial.println("[BLE] Delivered pending MAC notification");
    }

    // Periodic BLE status heartbeat (every 10 seconds)
    static unsigned long lastBleDebug = 0;
    if (millis() - lastBleDebug > 10000)
    {
        lastBleDebug = millis();
        Serial.print("[BLE] Heartbeat: advertising=");
        Serial.print(pServer->getConnectedCount() == 0 ? "yes" : "no (client connected)");
        Serial.print(", connected_clients=");
        Serial.println(pServer->getConnectedCount());
    }
}

void BluetoothProvisioning::onConnect(BLEServer *pServer)
{
    Serial.println("[BLE] >>> onConnect callback fired");
    deviceConnected = true;
}

void BluetoothProvisioning::onDisconnect(BLEServer *pServer)
{
    Serial.println("[BLE] >>> onDisconnect callback fired");
    deviceConnected = false;
}

void BluetoothProvisioning::onWrite(BLECharacteristic *pCharacteristic)
{
    std::string value = pCharacteristic->getValue();
    String sValue = String(value.c_str());

    if (pCharacteristic == pCharSSID)
    {
        Serial.print("[BLE] SSID written: '");
        Serial.print(sValue);
        Serial.println("'");
        tempSSID = sValue;
        updateStatus("SSID set");
    }
    else if (pCharacteristic == pCharPassword)
    {
        Serial.println("[BLE] Password written (hidden)");
        tempPassword = sValue;
        if (onCredentials) onCredentials(tempSSID, tempPassword);
        updateStatus("Creds saved");
        if (onReconnect) onReconnect();
    }
    else if (pCharacteristic == pCharCommand)
    {
        Serial.print("[BLE] Command written: '");
        Serial.print(sValue);
        Serial.println("'");
    }
}

void BluetoothProvisioning::updateStatus(const String &status)
{
    if (!pCharStatus) return;

    if (pCharStatus->getValue() == status.c_str()) return;

    Serial.print("[BLE] Status -> '");
    Serial.print(status);
    Serial.print("' notify=");
    pCharStatus->setValue(status.c_str());
    if (canNotify(pStatusDescriptor))
    {
        pCharStatus->notify();
        Serial.println("sent");
    }
    else
    {
        statusNotifyPending = true;
        Serial.println("queued");
    }
}

void BluetoothProvisioning::updateWiFiState(bool connected)
{
    Serial.print("[BLE] WiFi state changed: ");
    Serial.println(connected ? "connected" : "disconnected");
    updateStatus(connected ? "WiFi Connected" : "WiFi Disconnected");
    if (connected)
    {
        updateMACAddress();
    }
}

void BluetoothProvisioning::updateMACAddress()
{
    if (!pCharMAC) return;
    String mac = WiFi.macAddress();
    Serial.print("[BLE] MAC address set: ");
    Serial.print(mac);
    pCharMAC->setValue(mac.c_str());
    if (canNotify(pMacDescriptor))
    {
        pCharMAC->notify();
        Serial.println(" notify=sent");
    }
    else
    {
        macNotifyPending = true;
        Serial.println(" notify=queued");
    }
}

bool BluetoothProvisioning::canNotify(BLE2902 *descriptor)
{
    return deviceConnected && descriptor && descriptor->getNotifications();
}
