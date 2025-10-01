#pragma once

#include <Arduino.h>
#include <BLECharacteristic.h>
#include <BLEServer.h>
#include <vector>

#include "wifi_credentials.h"

enum class ImprovState : uint8_t
{
  Ready = 0,
  AuthorizationRequired = 1,
  Authorized = 2,
  Provisioning = 3,
  Provisioned = 4,
  Error = 5,
};

enum class ImprovError : uint8_t
{
  None = 0,
  InvalidRpc = 1,
  UnknownRpc = 2,
  Unauthorized = 3,
  Provisioning = 4,
  WifiAuthFailed = 5,
  WifiFailed = 6,
  WifiTimeout = 7,
};

enum class ImprovCommand : uint8_t
{
  SetWifiCredentials = 0x01,
};

class ImprovManager : public BLECharacteristicCallbacks
{
public:
  explicit ImprovManager(WiFiCredentialsStore &store);

  void begin();
  void loop();

  ImprovState getState() const;

protected:
  void onWrite(BLECharacteristic *characteristic) override;

private:
  void setupService();
  void startAdvertising();

  void handleCommand(const uint8_t *data, size_t length);
  void handleSetWifiCredentials(const uint8_t *data, size_t length);
  void processIncomingBuffer();

  void setState(ImprovState nextState);
  void setError(ImprovError error);
  void sendRpcResult(ImprovCommand command, const std::vector<uint8_t> &payload);
  void sendRpcText(ImprovCommand command, const char *text);
  void sendConnectionSummary();

  void notifyState();
  void notifyError();

  static uint8_t computeChecksum(const uint8_t *data, size_t length);

  void markProvisioningStart();
  void handleProvisioningProgress();
  void handleProvisioningFailure(ImprovError error);

  WiFiCredentialsStore &credentials;
  BLEServer *server;
  BLECharacteristic *stateCharacteristic;
  BLECharacteristic *errorCharacteristic;
  BLECharacteristic *commandCharacteristic;
  BLECharacteristic *rpcResultCharacteristic;
  BLECharacteristic *versionCharacteristic;
  BLECharacteristic *capabilitiesCharacteristic;

  ImprovState currentState;
  ImprovError currentError;
  unsigned long lastStateChange;
  unsigned long provisioningStart;
  bool provisioningInProgress;
  bool successNotified;
  std::vector<uint8_t> inboundBuffer;
};
