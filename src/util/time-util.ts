export function toTimestamp(currentTimestamp: number, date: Date) {
  return Math.floor(
    currentTimestamp + (date.getTime() - new Date().getTime()) / 1000,
  );
}

export function toDate(currentTimestamp: number, valueTimestamp: number) {
  return new Date(
    new Date().getTime() + (valueTimestamp - currentTimestamp) * 1000,
  );
}
