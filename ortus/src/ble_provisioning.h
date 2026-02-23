#pragma once

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <functional>

class BluetoothProvisioning : public BLEServerCallbacks, public BLECharacteristicCallbacks
{
public:
    using CredentialsCallback = std::function<void(String, String)>;
    using VoidCallback = std::function<void()>;

    BluetoothProvisioning();

    void begin(CredentialsCallback onCredentials, VoidCallback onReconnect);
    void loop();
    
    void updateStatus(const String &status);
    void updateWiFiState(bool connected);

    // BLE Server callbacks
    void onConnect(BLEServer *pServer) override;
    void onDisconnect(BLEServer *pServer) override;

    // BLE Characteristic callbacks
    void onWrite(BLECharacteristic *pCharacteristic) override;

private:
    CredentialsCallback onCredentials;
    VoidCallback onReconnect;

    BLEServer *pServer;
    BLECharacteristic *pCharSSID;
    BLECharacteristic *pCharPassword;
    BLECharacteristic *pCharStatus;
    BLECharacteristic *pCharMAC;
    BLECharacteristic *pCharCommand;
    BLE2902 *pStatusDescriptor;
    BLE2902 *pMacDescriptor;

    bool deviceConnected;
    bool oldDeviceConnected;
    String tempSSID;
    String tempPassword;
    
    bool statusNotifyPending;
    bool macNotifyPending;

    void updateMACAddress();
    bool canNotify(BLE2902 *descriptor);
};
