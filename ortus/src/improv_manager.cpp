#include "improv_manager.h"

#include <BLE2902.h>
#include <BLEDevice.h>
#include <WiFi.h>
#include <algorithm>
#include <cstring>

namespace
{
  constexpr char DEVICE_NAME[] = "Ortus Device";

  constexpr char IMPROV_SERVICE_UUID[] = "00004677-0000-1000-8000-00805f9b34fb";
  constexpr char CHAR_VERSION_UUID[] = "00467768-6228-2272-4663-277478268000";
  constexpr char CHAR_STATE_UUID[] = "00467768-6228-2272-4663-277478268001";
  constexpr char CHAR_ERROR_UUID[] = "00467768-6228-2272-4663-277478268002";
  constexpr char CHAR_RPC_COMMAND_UUID[] = "00467768-6228-2272-4663-277478268003";
  constexpr char CHAR_RPC_RESULT_UUID[] = "00467768-6228-2272-4663-277478268004";
  constexpr char CHAR_CAPABILITIES_UUID[] = "00467768-6228-2272-4663-277478268005";

  constexpr uint8_t WIFI_CAPABILITY_FLAG = 0x01;
  constexpr unsigned long PROVISIONING_TIMEOUT_MS = 60UL * 1000UL;
  constexpr unsigned long ERROR_DISPLAY_MS = 5000UL;
} // namespace

ImprovManager::ImprovManager(WiFiCredentialsStore &store)
    : credentials(store),
      server(nullptr),
      stateCharacteristic(nullptr),
      errorCharacteristic(nullptr),
      commandCharacteristic(nullptr),
      rpcResultCharacteristic(nullptr),
      versionCharacteristic(nullptr),
      capabilitiesCharacteristic(nullptr),
      currentState(ImprovState::Ready),
      currentError(ImprovError::None),
      lastStateChange(0),
      provisioningStart(0),
      provisioningInProgress(false),
      successNotified(false)
{
}

void ImprovManager::begin()
{
  credentials.begin();

  Serial.println(F("[Improv] Initializing BLE service"));
  Serial.printf("[Improv] Stored SSID: %s\n", credentials.hasCredentials() ? credentials.getSsid().c_str() : "<none>");

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P9);

  server = BLEDevice::createServer();

  setupService();
  startAdvertising();

  Serial.println(F("[Improv] BLE service ready"));

  if (WiFi.status() == WL_CONNECTED)
  {
    setState(ImprovState::Provisioned);
  }
  else
  {
    setState(ImprovState::Ready);
  }
}

void ImprovManager::loop()
{
  handleProvisioningProgress();

  if (currentState == ImprovState::Error)
  {
    const unsigned long now = millis();
    if (now - lastStateChange >= ERROR_DISPLAY_MS)
    {
      setError(ImprovError::None);
      setState(ImprovState::Ready);
    }
  }

  if (!provisioningInProgress)
  {
    if (WiFi.status() == WL_CONNECTED && currentState != ImprovState::Provisioned)
    {
      setError(ImprovError::None);
      setState(ImprovState::Provisioned);
      sendConnectionSummary();
      successNotified = true;
    }
    else if (WiFi.status() != WL_CONNECTED && currentState == ImprovState::Provisioned)
    {
      setState(ImprovState::Ready);
      successNotified = false;
    }
  }
}

ImprovState ImprovManager::getState() const
{
  return currentState;
}

void ImprovManager::onWrite(BLECharacteristic *characteristic)
{
  std::string value = characteristic->getValue();
  Serial.printf("[Improv] RPC payload received (%u bytes)\n", static_cast<unsigned>(value.size()));
  if (value.empty())
  {
    return;
  }

  const uint8_t *dataPtr = reinterpret_cast<const uint8_t *>(value.data());
  inboundBuffer.insert(inboundBuffer.end(), dataPtr, dataPtr + value.size());
  Serial.printf("[Improv] Buffered %u bytes\n", static_cast<unsigned>(inboundBuffer.size()));

  processIncomingBuffer();
}

void ImprovManager::setupService()
{
  auto *service = server->createService(IMPROV_SERVICE_UUID);

  versionCharacteristic = service->createCharacteristic(
      CHAR_VERSION_UUID,
      BLECharacteristic::PROPERTY_READ);
  versionCharacteristic->setValue("improv-wifi v1");

  stateCharacteristic = service->createCharacteristic(
      CHAR_STATE_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  stateCharacteristic->addDescriptor(new BLE2902());

  errorCharacteristic = service->createCharacteristic(
      CHAR_ERROR_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  errorCharacteristic->addDescriptor(new BLE2902());

  commandCharacteristic = service->createCharacteristic(
      CHAR_RPC_COMMAND_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  commandCharacteristic->setCallbacks(this);

  rpcResultCharacteristic = service->createCharacteristic(
      CHAR_RPC_RESULT_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  rpcResultCharacteristic->addDescriptor(new BLE2902());

  capabilitiesCharacteristic = service->createCharacteristic(
      CHAR_CAPABILITIES_UUID,
      BLECharacteristic::PROPERTY_READ);
  uint8_t capabilities = WIFI_CAPABILITY_FLAG;
  capabilitiesCharacteristic->setValue(&capabilities, 1);

  service->start();

  notifyState();
  notifyError();
}

void ImprovManager::startAdvertising()
{
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(IMPROV_SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();

  Serial.println(F("[Improv] Advertising started"));
}

void ImprovManager::handleCommand(const uint8_t *data, size_t length)
{
  if (length < 3)
  {
    handleProvisioningFailure(ImprovError::InvalidRpc);
    Serial.println(F("[Improv] RPC rejected: too short"));
    return;
  }

  const uint8_t commandId = data[0];
  const uint8_t payloadLength = data[1];

  if (payloadLength + 3 > length)
  {
    handleProvisioningFailure(ImprovError::InvalidRpc);
    Serial.println(F("[Improv] RPC rejected: payload length mismatch"));
    return;
  }

  const uint8_t checksum = data[2 + payloadLength];
  const uint8_t expected = computeChecksum(data, 2 + payloadLength);

  if (checksum != expected)
  {
    Serial.printf("[Improv] Checksum mismatch: provided 0x%02X expected 0x%02X\n", checksum, expected);
    Serial.print(F("[Improv] Bytes: "));
    for (size_t i = 0; i < length; ++i)
    {
      Serial.printf("%02X ", data[i]);
    }
    Serial.println();

    handleProvisioningFailure(ImprovError::InvalidRpc);
    return;
  }

  const uint8_t *payload = data + 2;

  if (static_cast<ImprovCommand>(commandId) == ImprovCommand::SetWifiCredentials)
  {
    handleSetWifiCredentials(payload, payloadLength);
  }
  else
  {
    Serial.printf("[Improv] RPC rejected: unknown command 0x%02X\n", commandId);
    handleProvisioningFailure(ImprovError::UnknownRpc);
  }
}

void ImprovManager::handleSetWifiCredentials(const uint8_t *data, size_t length)
{
  if (length < 2)
  {
    handleProvisioningFailure(ImprovError::InvalidRpc);
    Serial.println(F("[Improv] Credentials block too short"));
    return;
  }

  const uint8_t ssidLength = data[0];
  if (ssidLength + 1 > length)
  {
    handleProvisioningFailure(ImprovError::InvalidRpc);
    Serial.println(F("[Improv] SSID length field invalid"));
    return;
  }

  const uint8_t passwordLength = data[1 + ssidLength];
  if (1 + ssidLength + 1 + passwordLength > length)
  {
    handleProvisioningFailure(ImprovError::InvalidRpc);
    Serial.println(F("[Improv] Password length field invalid"));
    return;
  }

  const char *ssidPtr = reinterpret_cast<const char *>(data + 1);
  const char *passwordPtr = reinterpret_cast<const char *>(data + 1 + ssidLength + 1);

  const String ssid(ssidPtr, ssidLength);
  const String password(passwordPtr, passwordLength);

  Serial.print("[Improv] Received credentials for SSID: ");
  Serial.println(ssid);

  credentials.save(ssid, password);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(ssid.c_str(), password.c_str());
  Serial.println(F("[Improv] Triggered Wi-Fi connection attempt"));

  setError(ImprovError::None);
  setState(ImprovState::Provisioning);
  markProvisioningStart();
  successNotified = false;
}

void ImprovManager::setState(ImprovState nextState)
{
  if (currentState == nextState)
  {
    return;
  }

  currentState = nextState;
  lastStateChange = millis();
  provisioningInProgress = (currentState == ImprovState::Provisioning);
  notifyState();
}

void ImprovManager::setError(ImprovError error)
{
  if (currentError == error)
  {
    return;
  }

  currentError = error;
  notifyError();
}

void ImprovManager::sendRpcResult(ImprovCommand command, const std::vector<uint8_t> &payload)
{
  std::vector<uint8_t> packet(3 + payload.size());
  packet[0] = static_cast<uint8_t>(command);
  packet[1] = static_cast<uint8_t>(payload.size());
  std::copy(payload.begin(), payload.end(), packet.begin() + 2);
  packet[packet.size() - 1] = computeChecksum(packet.data(), packet.size() - 1);

  rpcResultCharacteristic->setValue(packet.data(), packet.size());
  rpcResultCharacteristic->notify();
}

void ImprovManager::sendRpcText(ImprovCommand command, const char *text)
{
  if (text == nullptr)
  {
    return;
  }

  const size_t length = strlen(text);
  std::vector<uint8_t> payload(length);
  for (size_t i = 0; i < length; ++i)
  {
    payload[i] = static_cast<uint8_t>(text[i]);
  }

  sendRpcResult(command, payload);
}

void ImprovManager::notifyState()
{
  if (!stateCharacteristic)
  {
    return;
  }

  uint8_t value = static_cast<uint8_t>(currentState);
  stateCharacteristic->setValue(&value, 1);
  stateCharacteristic->notify();
}

void ImprovManager::notifyError()
{
  if (!errorCharacteristic)
  {
    return;
  }

  uint8_t value = static_cast<uint8_t>(currentError);
  errorCharacteristic->setValue(&value, 1);
  errorCharacteristic->notify();
}

uint8_t ImprovManager::computeChecksum(const uint8_t *data, size_t length)
{
  uint32_t sum = 0;
  for (size_t i = 0; i < length; i++)
  {
    sum += data[i];
  }
  return static_cast<uint8_t>(sum & 0xFF);
}

void ImprovManager::markProvisioningStart()
{
  provisioningStart = millis();
  provisioningInProgress = true;
}

void ImprovManager::handleProvisioningProgress()
{
  if (!provisioningInProgress)
  {
    return;
  }

  wl_status_t status = WiFi.status();
  if (status == WL_CONNECTED)
  {
    provisioningInProgress = false;
    setError(ImprovError::None);
    setState(ImprovState::Provisioned);
    if (!successNotified)
    {
      sendConnectionSummary();
      successNotified = true;
    }
    return;
  }

  const unsigned long now = millis();
  if (now - provisioningStart > PROVISIONING_TIMEOUT_MS)
  {
    provisioningInProgress = false;
    if (status == WL_CONNECT_FAILED)
    {
      handleProvisioningFailure(ImprovError::WifiFailed);
    }
    else if (status == WL_NO_SSID_AVAIL)
    {
      handleProvisioningFailure(ImprovError::WifiFailed);
    }
    else
    {
      handleProvisioningFailure(ImprovError::WifiTimeout);
    }
  }
}

void ImprovManager::handleProvisioningFailure(ImprovError error)
{
  provisioningInProgress = false;
  successNotified = false;
  setError(error);
  setState(ImprovState::Error);
  Serial.printf("[Improv] Provisioning failed with error %u\n", static_cast<unsigned>(error));
}

void ImprovManager::sendConnectionSummary()
{
  String mac = WiFi.macAddress();
  String ip = WiFi.localIP().toString();
  String message = "mac=" + mac + ";ip=" + ip;
  sendRpcText(ImprovCommand::SetWifiCredentials, message.c_str());
  Serial.printf("[Improv] Sent connection summary: %s\n", message.c_str());
}

void ImprovManager::processIncomingBuffer()
{
  while (inboundBuffer.size() >= 3)
  {
    const uint8_t payloadLength = inboundBuffer[1];
    const size_t expectedLength = static_cast<size_t>(payloadLength) + 3;

    if (expectedLength > 255)
    {
      Serial.printf("[Improv] RPC rejected: declared length too large (%u)\n", static_cast<unsigned>(payloadLength));
      handleProvisioningFailure(ImprovError::InvalidRpc);
      inboundBuffer.clear();
      return;
    }

    if (inboundBuffer.size() < expectedLength)
    {
      Serial.println(F("[Improv] Waiting for remaining RPC bytes"));
      return;
    }

    const ImprovState prevState = currentState;
    const ImprovError prevError = currentError;

    handleCommand(inboundBuffer.data(), expectedLength);
    inboundBuffer.erase(inboundBuffer.begin(), inboundBuffer.begin() + expectedLength);

    if (currentState == ImprovState::Error && currentError != ImprovError::None &&
        (prevState != currentState || prevError != currentError))
    {
      Serial.println(F("[Improv] Clearing buffer due to error state"));
      inboundBuffer.clear();
      return;
    }
  }
}
