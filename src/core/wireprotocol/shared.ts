import { ReadPreference } from '../topologies/read_preference';
import { MongoError } from '../error';

import { MsgHeader } from '../../../interfaces/message_response';

// TS-TODO resolve imports
const ServerType = require('../sdam/server_description').ServerType;
const TopologyDescription = require('../sdam/topology_description').TopologyDescription;

export const MESSAGE_HEADER_SIZE = 16;
export const COMPRESSION_DETAILS_SIZE = 9; // originalOpcode + uncompressedSize, compressorID

// OPCODE Numbers
// Defined at https://docs.mongodb.com/manual/reference/mongodb-wire-protocol/#request-opcodes
export const opcodes = {
  OP_REPLY: 1,
  OP_UPDATE: 2001,
  OP_INSERT: 2002,
  OP_QUERY: 2004,
  OP_GETMORE: 2005,
  OP_DELETE: 2006,
  OP_KILL_CURSORS: 2007,
  OP_COMPRESSED: 2012,
  OP_MSG: 2013
};

export function getReadPreference(
  cmd: { readPrefence: ReadPreference|string }|any,
  options: { readPrefence: ReadPreference|string }|any
) {
  // Default to command version of the readPreference
  var readPreference = cmd.readPreference || new ReadPreference('primary');
  // If we have an option readPreference override the command one
  if (options.readPreference) {
    readPreference = options.readPreference;
  }

  if (typeof readPreference === 'string') {
    readPreference = new ReadPreference(readPreference);
  }

  if (!(readPreference instanceof ReadPreference)) {
    throw new MongoError('read preference must be a ReadPreference instance');
  }

  return readPreference;
};

// Parses the header of a wire protocol message
export function parseHeader(message: Buffer): MsgHeader {
  return {
    length: message.readInt32LE(0),
    requestId: message.readInt32LE(4),
    responseTo: message.readInt32LE(8),
    opCode: message.readInt32LE(12)
  };
};

// TS-TODO
export function applyCommonQueryOptions(queryOptions: any, options: any) {
  Object.assign(queryOptions, {
    raw: typeof options.raw === 'boolean' ? options.raw : false,
    promoteLongs: typeof options.promoteLongs === 'boolean' ? options.promoteLongs : true,
    promoteValues: typeof options.promoteValues === 'boolean' ? options.promoteValues : true,
    promoteBuffers: typeof options.promoteBuffers === 'boolean' ? options.promoteBuffers : false,
    monitoring: typeof options.monitoring === 'boolean' ? options.monitoring : false,
    fullResult: typeof options.fullResult === 'boolean' ? options.fullResult : false
  });

  if (typeof options.socketTimeout === 'number') {
    queryOptions.socketTimeout = options.socketTimeout;
  }

  if (options.session) {
    queryOptions.session = options.session;
  }

  if (typeof options.documentsReturnedIn === 'string') {
    queryOptions.documentsReturnedIn = options.documentsReturnedIn;
  }

  return queryOptions;
}

// TS-TODO
export function isSharded(topologyOrServer: any) {
  if (topologyOrServer.type === 'mongos') return true;
  if (topologyOrServer.description && topologyOrServer.description.type === ServerType.Mongos) {
    return true;
  }

  // NOTE: This is incredibly inefficient, and should be removed once command construction
  //       happens based on `Server` not `Topology`.
  if (topologyOrServer.description && topologyOrServer.description instanceof TopologyDescription) {
    const servers = Array.from(topologyOrServer.description.servers.values());
    return servers.some((server: any) => server.type === ServerType.Mongos);
  }

  return false;
}

export function databaseNamespace(ns: string) {
  return ns.split('.')[0];
}
export function collectionNamespace(ns: string) {
  return ns
    .split('.')
    .slice(1)
    .join('.');
}
