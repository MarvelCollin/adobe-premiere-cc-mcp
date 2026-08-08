/** The panel could not be reached, or it returned something we cannot use. */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

/** The script reached Premiere but the host reported a failure. */
export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}
