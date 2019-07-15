export interface DriverCallback {
  (err: Error|null|undefined, result?: any): void;
}
