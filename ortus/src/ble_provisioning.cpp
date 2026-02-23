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

    BLEDevice::init("Ortus-Provisioning");
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(this);

    BLEService *pService = pServer->createService(BLE_SERVICE_UUID);

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

    pService->start();
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    BLEDevice::startAdvertising();

    updateStatus("BLE Ready");
    updateMACAddress();
}

void BluetoothProvisioning::loop()
{
    if (!deviceConnected && oldDeviceConnected)
    {
        delay(500); 
        pServer->startAdvertising(); 
        oldDeviceConnected = deviceConnected;
        updateStatus("Disconnected");
    }
    
    if (deviceConnected && !oldDeviceConnected)
    {
        oldDeviceConnected = deviceConnected;
        updateStatus("Connected");
        updateMACAddress();
    }

    if (statusNotifyPending && canNotify(pStatusDescriptor))
    {
        pCharStatus->notify();
        statusNotifyPending = false;
    }
    if (macNotifyPending && canNotify(pMacDescriptor))
    {
        pCharMAC->notify();
        macNotifyPending = false;
    }
}

void BluetoothProvisioning::onConnect(BLEServer *pServer)
{
    deviceConnected = true;
}

void BluetoothProvisioning::onDisconnect(BLEServer *pServer)
{
    deviceConnected = false;
}

void BluetoothProvisioning::onWrite(BLECharacteristic *pCharacteristic)
{
    std::string value = pCharacteristic->getValue();
    String sValue = String(value.c_str());

    if (pCharacteristic == pCharSSID)
    {
        tempSSID = sValue;
        updateStatus("SSID set");
    }
    else if (pCharacteristic == pCharPassword)
    {
        tempPassword = sValue;
        if (onCredentials) onCredentials(tempSSID, tempPassword);
        updateStatus("Creds saved");
        if (onReconnect) onReconnect();
    }
    else if (pCharacteristic == pCharCommand)
    {
        // Simple commands if needed
    }
}

void BluetoothProvisioning::updateStatus(const String &status)
{
    if (!pCharStatus) return;

    if (pCharStatus->getValue() == status.c_str()) return;

    pCharStatus->setValue(status.c_str());
    if (canNotify(pStatusDescriptor)) pCharStatus->notify();
    else statusNotifyPending = true;
}

void BluetoothProvisioning::updateWiFiState(bool connected)
{
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
    pCharMAC->setValue(mac.c_str());
    if (canNotify(pMacDescriptor)) pCharMAC->notify();
    else macNotifyPending = true;
}

bool BluetoothProvisioning::canNotify(BLE2902 *descriptor)
{
    return deviceConnected && descriptor && descriptor->getNotifications();
}
