function toDbTimestamp(ms: number) {
  return Math.floor(ms / 1000); // store seconds
}

function fromDbTimestamp(seconds: number) {
  return seconds * 1000; // read as ms
}
