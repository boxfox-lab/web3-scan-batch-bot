export function isZeroAddress(address: string) {
  return parseInt(address, 16) === 0;
}
