import { InsufficientFundError } from './errors';

export function formatEVMRPCError(e: unknown) {
  if (!e || typeof e !== 'object') return e;
  //@ts-ignore
  if (!('reason' in e) || typeof e.reason !== 'string') {
    return e;
  }
  //@ts-ignore
  if (e.reason.includes('insufficient funds')) {
    return new InsufficientFundError(e);
  }
  return e;
}
