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


export interface IsMasterCommon extends CommandResponseCommon {
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
}

export interface IsMasterMongos {
  msg: 'isdbgrid';
}

export interface IsMasterReplicaSet {
  setName: string;
  setVersion: number;
  secondary: boolean;
  hosts: string[];
  passives: string[];
  arbiters: string[];
  primary: string;
  arbiterOnly: boolean;
  passive: boolean;
  hidden: boolean;
  tags?: Record<string,string>;
  me: string;
  // TS-TODO
  electionId?: unknown;
  lastWrite?: {
    opTime: OpTime
    lastWriteDate: Date;
    majorityOpTime: OpTime;
    majorityWriteDate: Date;
  }
}

export type IsMaster = IsMasterCommon & (IsMasterMongos | IsMasterReplicaSet);
