export class BasicEVMRpciError extends Error {
  constructor(public readonly source: unknown) {
    super();
  }
}

export class InsufficientFundError extends BasicEVMRpciError {}
export class InsufficientGasError extends BasicEVMRpciError {}
