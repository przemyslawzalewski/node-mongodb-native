import { ConnectionInterface } from './connection';
import { DriverCallback } from './driver_callback';

export interface RunCommandOnConnection<T=any> {
  (conn: ConnectionInterface, ns: string, command: any, options: any, callback: DriverCallback<T>): void;
  (conn: ConnectionInterface, ns: string, command: any, callback: DriverCallback<T>): void;
}
