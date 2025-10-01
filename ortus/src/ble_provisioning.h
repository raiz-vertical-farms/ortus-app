#ifndef BLUETOOTH_PROVISIONING_H
#define BLUETOOTH_PROVISIONING_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "wifi_credentials.h"
#include "network_manager.h"

// BLE UUIDs
#define BLE_SERVICE_UUID "12345678-1234-5678-1234-56789abcdef0"
#define BLE_CHAR_SSID_UUID "12345678-1234-5678-1234-56789abcdef1"
#define BLE_CHAR_PASSWORD_UUID "12345678-1234-5678-1234-56789abcdef2"
#define BLE_CHAR_STATUS_UUID "12345678-1234-5678-1234-56789abcdef3"
#define BLE_CHAR_MAC_UUID "12345678-1234-5678-1234-56789abcdef4"
#define BLE_CHAR_COMMAND_UUID "12345678-1234-5678-1234-56789abcdef5"

class BluetoothProvisioning : public BLEServerCallbacks, public BLECharacteristicCallbacks
{
public:
    BluetoothProvisioning(WiFiCredentialsStore &credentialsStore, NetworkManager &networkManager);

    void begin();
    void stop();
    bool isActive() const { return bleActive; }
    void checkAutoStop();

    // BLE Server callbacks
    void onConnect(BLEServer *pServer) override;
    void onDisconnect(BLEServer *pServer) override;

    // BLE Characteristic callbacks
    void onWrite(BLECharacteristic *pCharacteristic) override;
    void onRead(BLECharacteristic *pCharacteristic) override;

private:
    WiFiCredentialsStore &credentials;
    NetworkManager &network;

    BLEServer *pServer;
    BLEService *pService;
    BLECharacteristic *pCharSSID;
    BLECharacteristic *pCharPassword;
    BLECharacteristic *pCharStatus;
    BLECharacteristic *pCharMAC;
    BLECharacteristic *pCharCommand;

    String tempSSID;
    String tempPassword;
    bool bleActive;
    bool deviceConnected;
    unsigned long lastActivityTime;

    void updateStatus(const String &status);
    void updateMACAddress();
    bool connectWithCredentials();
    void processCommand(const String &command);

    static const unsigned long BLE_TIMEOUT_MS = 300000; // 5 minutes
};

#endif // BLUETOOTH_PROVISIONING_H