export function getTimestampByHoursAndMinutes(hours: number, minutes: number) {
  const now = new Date();
  now.setHours(hours);
  now.setMinutes(minutes);
  now.setSeconds(0);
  now.setMilliseconds(0);
  return now.getTime();
}

export function getHoursAndMinutesByTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return {
    hours: date.getHours(),
    minutes: date.getMinutes(),
  };
}
