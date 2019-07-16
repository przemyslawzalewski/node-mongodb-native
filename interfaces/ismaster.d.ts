import { Timestamp } from 'bson';

export interface OpTime {
  ts: Timestamp;
  t: unknown;
}

export interface ClusterTime {
  clusterTime: Timestamp;
}

export interface CommandResponseCommon {
  ok: 1|0;
  operationTime?: Timestamp;
  $clusterTime?: ClusterTime;
}


export interface IsMaster extends CommandResponseCommon {
  ismaster: boolean;
  maxBsonObjectSize: number;
  maxMessageSizeBytes: number;
  maxWriteBatchSize: number;
  localTime: Date;
  logicalSessionTimeoutMinutes?: number;
  minWireVersion: number;
  maxWireVersion: number;
  readOnly?: boolean;
  compression?: string[];
  saslSupportedMechs?: string[];

  // Mongos Fields
  msg?: 'isdbgrid';

  // ReplicaSet Fields
  setName?: string;
  setVersion?: number;
  secondary?: boolean;
  hosts?: string[];
  passives?: string[];
  arbiters?: string[];
  primary?: string;
  arbiterOnly?: boolean;
  passive?: boolean;
  hidden?: boolean;
  tags?: Record<string,string>;
  me?: string;
  // TS-TODO
  electionId?: unknown;
  lastWrite?: {
    opTime: OpTime
    lastWriteDate: Date;
    majorityOpTime: OpTime;
    majorityWriteDate: Date;
  }
}
