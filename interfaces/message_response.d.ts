export interface MsgHeader {
  length: number;
  requestId: number;
  responseTo: number;
  opCode: number;
  fromCompressed?: boolean;
}

export interface ResponseOptions {
  promoteLongs?: boolean;
  promoteValues?: boolean;
  promoteBuffers?: boolean;
}

export interface ParseOptions {
  raw?: boolean;
  documentsReturnedIn?: string;
  promoteLongs?: boolean;
  promoteValues?: boolean;
  promoteBuffers?: boolean;
}