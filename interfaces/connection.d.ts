import { BSON } from 'bson';
import { EventEmitter } from 'events';

export interface ConnectionInterface extends EventEmitter {
  options: {
    bson: BSON;
  };
  write(buff: Buffer|Buffer[]): void;
  setSocketTimeout(timeout: number): void;
  resetSocketTimeout(): void
}
