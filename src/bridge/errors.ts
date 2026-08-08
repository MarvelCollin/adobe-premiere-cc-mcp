export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}
