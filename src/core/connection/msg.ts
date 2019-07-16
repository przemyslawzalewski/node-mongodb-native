// Implementation of OP_MSG spec:
// https://github.com/mongodb/specifications/blob/master/source/message/OP_MSG.rst
//
// struct Section {
//   uint8 payloadType;
//   union payload {
//       document  document; // payloadType == 0
//       struct sequence { // payloadType == 1
//           int32      size;
//           cstring    identifier;
//           document*  documents;
//       };
//   };
// };

// struct OP_MSG {
//   struct MsgHeader {
//       int32  messageLength;
//       int32  requestID;
//       int32  responseTo;
//       int32  opCode = 2013;
//   };
//   uint32      flagBits;
//   Section+    sections;
//   [uint32     checksum;]
// };

import { opcodes, databaseNamespace } from '../wireprotocol/shared';
import { ReadPreference } from '../topologies/read_preference';
import { BSON } from 'bson';
import { MsgHeader, ResponseOptions, ParseOptions } from '../../../interfaces/message_response';
import { Response } from './commands';
import { MessageChannel } from 'worker_threads';

// Incrementing request id
let _requestId = 0;

// Msg Flags
const OPTS_CHECKSUM_PRESENT = 1;
const OPTS_MORE_TO_COME = 2;
const OPTS_EXHAUST_ALLOWED = 1 << 16;

type MsgOptions = {
  readPreference?: ReadPreference;
  serializeFunctions?: boolean;
  ignoreUndefined?: boolean;
  checkKeys?: boolean;
  maxBsonSize?: number;
  moreToCome?: boolean;
}

export class Msg {
  options: MsgOptions;
  requestId: number;
  serializeFunctions: boolean;
  ignoreUndefined: boolean;
  checkKeys: boolean;
  maxBsonSize: number;
  checksumPresent: boolean;
  moreToCome: boolean;
  exhaustAllowed: boolean;

  constructor(
    public bson: BSON,
    public ns: string,
    public command: any,
    options: MsgOptions) {
    // Basic options needed to be passed in
    if (command == null) throw new Error('query must be specified for query');

    // Basic options
    this.bson = bson;
    this.ns = ns;
    this.command = command;
    this.command.$db = databaseNamespace(ns);

    if (options.readPreference && options.readPreference.mode !== ReadPreference.PRIMARY) {
      this.command.$readPreference = options.readPreference.toJSON();
    }

    // Ensure empty options
    this.options = options || {};

    // Additional options
    this.requestId = Msg.getRequestId();

    // Serialization option
    this.serializeFunctions =
      typeof options.serializeFunctions === 'boolean' ? options.serializeFunctions : false;
    this.ignoreUndefined =
      typeof options.ignoreUndefined === 'boolean' ? options.ignoreUndefined : false;
    this.checkKeys = typeof options.checkKeys === 'boolean' ? options.checkKeys : false;
    this.maxBsonSize = options.maxBsonSize || 1024 * 1024 * 16;

    // flags
    this.checksumPresent = false;
    this.moreToCome = options.moreToCome || false;
    this.exhaustAllowed = false;
  }

  toBin() {
    const buffers = [];
    let flags = 0;

    if (this.checksumPresent) {
      flags |= OPTS_CHECKSUM_PRESENT;
    }

    if (this.moreToCome) {
      flags |= OPTS_MORE_TO_COME;
    }

    if (this.exhaustAllowed) {
      flags |= OPTS_EXHAUST_ALLOWED;
    }

    const header = new Buffer(
      4 * 4 + // Header
        4 // Flags
    );

    buffers.push(header);

    let totalLength = header.length;
    const command = this.command;
    totalLength += this.makeDocumentSegment(buffers, command);

    header.writeInt32LE(totalLength, 0); // messageLength
    header.writeInt32LE(this.requestId, 4); // requestID
    header.writeInt32LE(0, 8); // responseTo
    header.writeInt32LE(opcodes.OP_MSG, 12); // opCode
    header.writeUInt32LE(flags, 16); // flags
    return buffers;
  }

  makeDocumentSegment(buffers: Buffer[], document: any) {
    const payloadTypeBuffer = new Buffer(1);
    payloadTypeBuffer[0] = 0;

    const documentBuffer = this.serializeBson(document);
    buffers.push(payloadTypeBuffer);
    buffers.push(documentBuffer);

    return payloadTypeBuffer.length + documentBuffer.length;
  }

  serializeBson(document: any) {
    return this.bson.serialize(document, {
      checkKeys: this.checkKeys,
      serializeFunctions: this.serializeFunctions,
      ignoreUndefined: this.ignoreUndefined
    });
  }

  static getRequestId() {
    return ++_requestId;
  }
}

export class BinMsg {
  parsed: boolean;
  raw: Buffer;
  data: Buffer;
  
  length: number;
  requestId: number;
  responseTo: number;
  opCode: number;
  fromCompressed?: boolean;

  responseFlags: number;
  checksumPresent: boolean;
  moreToCome: boolean;
  exhaustAllowed: boolean;
  promoteLongs: boolean;
  promoteValues: boolean;
  promoteBuffers: boolean;

  documents: any[];

  index = 0;

  // TS-TODO
  hashedName?: string;

  constructor(
    public bson: BSON,
    message: Buffer,
    msgHeader: MsgHeader,
    msgBody: Buffer,
    public opts: ResponseOptions
  ) {
    opts = opts || { promoteLongs: true, promoteValues: true, promoteBuffers: false };
    this.parsed = false;
    this.raw = message;
    this.data = msgBody;
    this.bson = bson;
    this.opts = opts;

    // Read the message header
    this.length = msgHeader.length;
    this.requestId = msgHeader.requestId;
    this.responseTo = msgHeader.responseTo;
    this.opCode = msgHeader.opCode;
    this.fromCompressed = msgHeader.fromCompressed;

    // Read response flags
    this.responseFlags = msgBody.readInt32LE(0);
    this.checksumPresent = (this.responseFlags & OPTS_CHECKSUM_PRESENT) !== 0;
    this.moreToCome = (this.responseFlags & OPTS_MORE_TO_COME) !== 0;
    this.exhaustAllowed = (this.responseFlags & OPTS_EXHAUST_ALLOWED) !== 0;
    this.promoteLongs = typeof opts.promoteLongs === 'boolean' ? opts.promoteLongs : true;
    this.promoteValues = typeof opts.promoteValues === 'boolean' ? opts.promoteValues : true;
    this.promoteBuffers = typeof opts.promoteBuffers === 'boolean' ? opts.promoteBuffers : false;

    this.documents = [];
  }

  isParsed() {
    return this.parsed;
  }

  parse(options: ParseOptions) {
    // Don't parse again if not needed
    if (this.parsed) return;
    options = options || {};

    this.index = 4;
    // Allow the return of raw documents instead of parsing
    const raw = options.raw || false;
    const documentsReturnedIn = options.documentsReturnedIn || null;
    const promoteLongs =
      typeof options.promoteLongs === 'boolean' ? options.promoteLongs : this.opts.promoteLongs;
    const promoteValues =
      typeof options.promoteValues === 'boolean' ? options.promoteValues : this.opts.promoteValues;
    const promoteBuffers =
      typeof options.promoteBuffers === 'boolean'
        ? options.promoteBuffers
        : this.opts.promoteBuffers;

    // Set up the options
    const _options = {
      promoteLongs: promoteLongs,
      promoteValues: promoteValues,
      promoteBuffers: promoteBuffers
    };

    while (this.index < this.data.length) {
      const payloadType = this.data.readUInt8(this.index++);
      if (payloadType === 1) {
        console.error('TYPE 1');
      } else if (payloadType === 0) {
        const bsonSize = this.data.readUInt32LE(this.index);
        const bin = this.data.slice(this.index, this.index + bsonSize);
        this.documents.push(raw ? bin : this.bson.deserialize(bin, _options));

        this.index += bsonSize;
      }
    }

    // TS-TODO
    if (this.documents.length === 1 && documentsReturnedIn != null && raw) {
      const fieldsAsRaw: any = {};
      fieldsAsRaw[documentsReturnedIn] = true;
      (_options as any).fieldsAsRaw = fieldsAsRaw;

      const doc = this.bson.deserialize(this.documents[0], _options);
      this.documents = [doc];
    }

    this.parsed = true;
  }
}

module.exports = { Msg, BinMsg };
