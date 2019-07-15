import { ConnectionInterface } from './connection';

export interface RunCommandOnConnectionCallback {
  (err: Error, result: any): void;
}

export interface RunCommandOnConnection {
  (conn: ConnectionInterface, ns: string, command: any, options: any, callback: RunCommandOnConnectionCallback): void;
  (conn: ConnectionInterface, ns: string, command: any, callback: RunCommandOnConnectionCallback): void;
}
