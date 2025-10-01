#include "ble_provisioning.h"

BluetoothProvisioning::BluetoothProvisioning(WiFiCredentialsStore &credentialsStore, NetworkManager &networkManager)
    : credentials(credentialsStore), network(networkManager),
      pServer(nullptr), pService(nullptr),
      pCharSSID(nullptr), pCharPassword(nullptr), pCharStatus(nullptr), pCharMAC(nullptr), pCharCommand(nullptr),
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

    pCharMAC = pService->createCharacteristic(BLE_CHAR_MAC_UUID, BLECharacteristic::PROPERTY_READ);
    pCharMAC->setCallbacks(this);

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
}

void BluetoothProvisioning::stop()
{
    if (bleActive)
    {
        BLEDevice::stopAdvertising();
        bleActive = false;
        updateStatus("BLE stopped");
    }
}

void BluetoothProvisioning::checkAutoStop()
{
    if (bleActive && millis() - lastActivityTime > BLE_TIMEOUT_MS)
    {
        stop();
    }
}

void BluetoothProvisioning::onConnect(BLEServer *pServer)
{
    deviceConnected = true;
    lastActivityTime = millis();
    updateStatus("Device connected");
}

void BluetoothProvisioning::onDisconnect(BLEServer *pServer)
{
    deviceConnected = false;
    updateStatus("Device disconnected");
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
        connectWithCredentials();
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
        pCharStatus->notify();
    }
    Serial.println("[BLE] " + status);
}

void BluetoothProvisioning::updateMACAddress()
{
    if (pCharMAC)
    {
        String mac = WiFi.macAddress();
        pCharMAC->setValue(mac.c_str());
    }
}

bool BluetoothProvisioning::connectWithCredentials()
{
    network.connectWiFi();
    if (WiFi.status() == WL_CONNECTED)
    {
        updateStatus("WiFi connected");
        return true;
    }
    else
    {
        updateStatus("WiFi failed");
        return false;
    }
}

void BluetoothProvisioning::processCommand(const String &command)
{
    if (command == "STOP")
    {
        stop();
    }
}
