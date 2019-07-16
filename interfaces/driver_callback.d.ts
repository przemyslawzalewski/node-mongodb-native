export interface DriverCallback<T=any> {
  (err: Error|null|undefined, result?: null|T): void;
}
