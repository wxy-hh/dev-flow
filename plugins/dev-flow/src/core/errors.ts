export class DevFlowError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
  }
}
