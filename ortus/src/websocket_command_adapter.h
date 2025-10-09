#pragma once

#include <WebSocketsServer.h>
#include "command_adapter.h"

class WebSocketCommandAdapter : public CommandAdapter
{
public:
  explicit WebSocketCommandAdapter(uint16_t port);

  void begin() override;
  void loop() override;
  void notifyState(const DeviceState &state) override;
  uint16_t port() const { return serverPort; }

private:
  static void handleEventRouter(uint8_t clientNum, WStype_t type, uint8_t *payload, size_t length);
  void handleEvent(uint8_t clientNum, WStype_t type, uint8_t *payload, size_t length);
  void broadcastState(const DeviceState &state);

  WebSocketsServer server;
  uint16_t serverPort;
  DeviceState lastBroadcastState;
  bool hasBroadcastState;

  static WebSocketCommandAdapter *instance;
};

