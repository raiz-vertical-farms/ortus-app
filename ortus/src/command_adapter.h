#pragma once

#include <functional>
#include "command_types.h"

class CommandAdapter
{
public:
  using CommandHandler = std::function<void(const DeviceCommand &)>;
  virtual ~CommandAdapter() = default;

  void setCommandHandler(CommandHandler handler)
  {
    commandHandler = handler;
  }

  virtual void begin() = 0;
  virtual void loop() = 0;
  virtual void notifyState(const DeviceState &state) = 0;

protected:
  void dispatchCommand(const DeviceCommand &command)
  {
    if (commandHandler)
    {
      commandHandler(command);
    }
  }

private:
  CommandHandler commandHandler;
};

