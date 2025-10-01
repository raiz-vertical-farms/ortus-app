export function toSQLiteTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}
