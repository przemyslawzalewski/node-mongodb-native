'use strict';

import { createConnection, Socket, SocketConnectOpts } from 'net';
import { connect as tlsConnect, TLSSocket, ConnectionOptions as TLSConnectOps, CipherNameAndProtocol, TlsOptions } from 'tls';
import { Connection, SocketOptions } from './connection';
import { Query } from './commands';
import { MongoError, MongoNetworkError } from '../error';
import { defaultAuthProviders } from '../auth/defaultAuthProviders';
import {
  MAX_SUPPORTED_SERVER_VERSION,
  MAX_SUPPORTED_WIRE_VERSION,
  MIN_SUPPORTED_WIRE_VERSION,
  MIN_SUPPORTED_SERVER_VERSION
} from '../wireprotocol/constants';

import { BinMsg } from './msg';
import { Response } from './commands';
import { DriverCallback } from '../../../interfaces/driver_callback';
import { BSON } from 'bson';
import { MongoCredentials } from '../auth/mongo_credentials';
import { AuthProvider } from '../auth/auth_provider';
import { ConnectionInterface } from '../../../interfaces/connection';
import { IsMaster } from '../../../interfaces/ismaster';


const createClientInfo = require('../topologies/shared').createClientInfo;
let AUTH_PROVIDERS: Record<string, AuthProvider>;

// 'pfx',
// 'key',
// 'passphrase',
// 'cert',
// 'ca',
// 'ciphers',
// 'NPNProtocols',
// 'ALPNProtocols',
// 'servername',
// 'ecdhCurve',
// 'secureProtocol',
// 'secureContext',
// 'session',
// 'minDHSize',
// 'crl',
// 'rejectUnauthorized'


type ValidTLSSocketOptions = 'pfx'|'key'|'passphrase'|'cert'|'ca'|'ciphers'|'ALPNProtocols'|'servername'|'ecdhCurve'|'secureProtocol'|'secureContext'|'session'|'minDHSize'|'crl'|'host'|'port'|'rejectUnauthorized';
type ConnectOptions = Pick<TLSConnectOps, ValidTLSSocketOptions>  & {
  bson: BSON;
  host?: string;
  port?: number;
  family?: 0|4|6;
  compression?: {
    compressors?: string[]
    zlibCompressionLevel?: unknown;
  };
  ssl?: boolean;
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  connectionTimeout?: number;
  socketTimeout?: number;
  noDelay?: boolean;
  credentials?: MongoCredentials;
  checkServerIdentity?: boolean;

  // Investigate these
  dbName?: string;
  user?: string;

  tag?: unknown;
  maxBsonMessageSize?: number;
  promoteLongs?: boolean;
  promoteValues?: boolean;
  promoteBuffers?: boolean;
}

export function connect(options: ConnectOptions, callback: DriverCallback<Connection|string>) {
  if (AUTH_PROVIDERS == null) {
    AUTH_PROVIDERS = defaultAuthProviders(options.bson);
  }

  if (options.family !== void 0) {
    makeConnection(options.family, options, (err, socket) => {
      if (err) {
        callback(err, socket as undefined|string); // in the error case, `socket` is the originating error event name
        return;
      }

      performInitialHandshake(new Connection(socket as Socket, options as SocketOptions), options, callback);
    });

    return;
  }

  return makeConnection(6, options, (err, ipv6Socket) => {
    if (err) {
      makeConnection(4, options, (err, ipv4Socket) => {
        if (err) {
          callback(err, ipv4Socket as undefined|string); // in the error case, `ipv4Socket` is the originating error event name
          return;
        }

        performInitialHandshake(new Connection(ipv4Socket as Socket, options as SocketOptions), options, callback);
      });

      return;
    }

    performInitialHandshake(new Connection(ipv6Socket as Socket, options as SocketOptions), options, callback);
  });
}

function getSaslSupportedMechs(options: ConnectOptions): object {
  if (!(options && options.credentials)) {
    return {};
  }

  const credentials = options.credentials;

  // TODO: revisit whether or not items like `options.user` and `options.dbName` should be checked here
  const authMechanism = credentials.mechanism;
  const authSource = credentials.source || options.dbName || 'admin';
  const user = credentials.username || options.user;

  if (typeof authMechanism === 'string' && authMechanism.toUpperCase() !== 'DEFAULT') {
    return {};
  }

  if (!user) {
    return {};
  }

  return { saslSupportedMechs: `${authSource}.${user}` };
}

function checkSupportedServer(ismaster: IsMaster, options: ConnectOptions) {
  const serverVersionHighEnough =
    ismaster &&
    typeof ismaster.maxWireVersion === 'number' &&
    ismaster.maxWireVersion >= MIN_SUPPORTED_WIRE_VERSION;
  const serverVersionLowEnough =
    ismaster &&
    typeof ismaster.minWireVersion === 'number' &&
    ismaster.minWireVersion <= MAX_SUPPORTED_WIRE_VERSION;

  if (serverVersionHighEnough) {
    if (serverVersionLowEnough) {
      return null;
    }

    const message = `Server at ${options.host}:${options.port} reports minimum wire version ${
      ismaster.minWireVersion
    }, but this version of the Node.js Driver requires at most ${MAX_SUPPORTED_WIRE_VERSION} (MongoDB ${MAX_SUPPORTED_SERVER_VERSION})`;
    return new MongoError(message);
  }

  const message = `Server at ${options.host}:${
    options.port
  } reports maximum wire version ${ismaster.maxWireVersion ||
    0}, but this version of the Node.js Driver requires at least ${MIN_SUPPORTED_WIRE_VERSION} (MongoDB ${MIN_SUPPORTED_SERVER_VERSION})`;
  return new MongoError(message);
}

function performInitialHandshake(
  conn: Connection,
  options: ConnectOptions,
  _callback: DriverCallback<Connection>
) {
  const callback = function(err: Error|null|undefined, ret?: Connection|null) {
    if (err && conn) {
      conn.destroy();
    }
    _callback(err, ret);
  };

  let compressors: string[] = [];
  if (options.compression && options.compression.compressors) {
    compressors = options.compression.compressors;
  }

  const handshakeDoc = Object.assign(
    {
      ismaster: true,
      client: createClientInfo(options),
      compression: compressors
    },
    getSaslSupportedMechs(options)
  );

  const start = new Date().getTime();
  runCommand(conn, 'admin.$cmd', handshakeDoc, options, (err, ismaster: IsMaster) => {
    if (err) {
      callback(err, null);
      return;
    }

    if (ismaster.ok === 0) {
      callback(new MongoError(ismaster), null);
      return;
    }

    const supportedServerErr = checkSupportedServer(ismaster, options);
    if (supportedServerErr) {
      callback(supportedServerErr, null);
      return;
    }

    // resolve compression
    if (ismaster.compression) {
      const agreedCompressors = compressors.filter(
        compressor => (ismaster.compression as NonNullable<typeof ismaster.compression>).indexOf(compressor) !== -1
      );

      // TS-TODO: THIS IS BAD
      if (agreedCompressors.length) {
        conn.agreedCompressor = agreedCompressors[0];
      }

      if (options.compression && options.compression.zlibCompressionLevel) {
        conn.zlibCompressionLevel = options.compression.zlibCompressionLevel;
      }
    }

    // NOTE: This is metadata attached to the connection while porting away from
    //       handshake being done in the `Server` class. Likely, it should be
    //       relocated, or at very least restructured.
    conn.ismaster = ismaster;
    conn.lastIsMasterMS = new Date().getTime() - start;

    const credentials = options.credentials;
    if (!ismaster.arbiterOnly && credentials) {
      credentials.resolveAuthMechanism(ismaster);
      authenticate(conn, credentials, callback);
      return;
    }

    callback(null, conn);
  });
}

const LEGAL_SSL_SOCKET_OPTIONS: (ValidTLSSocketOptions | 'NPNProtocols')[] = [
  'pfx',
  'key',
  'passphrase',
  'cert',
  'ca',
  'ciphers',
  'NPNProtocols',
  'ALPNProtocols',
  'servername',
  'ecdhCurve',
  'secureProtocol',
  'secureContext',
  'session',
  'minDHSize',
  'crl',
  'rejectUnauthorized'
];

function parseConnectOptions(
  family: 0|4|6|undefined,
  options: TLSConnectOps
): SocketConnectOpts {
  const host = typeof options.host === 'string' ? options.host : 'localhost';
  if (host.indexOf('/') !== -1) {
    return { path: host };
  }

  const result = {
    family,
    host,
    port: typeof options.port === 'number' ? options.port : 27017,
    rejectUnauthorized: false
  };

  return result;
}

// TS-TODO: checkServerIdentity
function parseSslOptions(
  family: 0|4|6|undefined,
  options: ConnectOptions
): TLSConnectOps {
  const result: TLSConnectOps = parseConnectOptions(family, options);

  // Merge in valid SSL options
  for (const name in options) {
    // TS-TODO
    // @ts-ignore
    if (options[name] != null && LEGAL_SSL_SOCKET_OPTIONS.indexOf(name) !== -1) {
      // @ts-ignore
      result[name] = options[name];
    }
  }

  // Override checkServerIdentity behavior
  if (options.checkServerIdentity === false) {
    // Skip the identiy check by retuning undefined as per node documents
    // https://nodejs.org/api/tls.html#tls_tls_connect_options_callback
    result.checkServerIdentity = function() {
      return undefined;
    };
  } else if (typeof options.checkServerIdentity === 'function') {
    result.checkServerIdentity = options.checkServerIdentity;
  }

  // Set default sni servername to be the same as host
  if (result.servername == null) {
    result.servername = result.host;
  }

  return result;
}

function makeConnection(family: 0|4|6|undefined, options: ConnectOptions, _callback: DriverCallback<Socket|string>) {
  const useSsl = typeof options.ssl === 'boolean' ? options.ssl : false;
  const keepAlive = typeof options.keepAlive === 'boolean' ? options.keepAlive : true;
  let keepAliveInitialDelay =
    typeof options.keepAliveInitialDelay === 'number' ? options.keepAliveInitialDelay : 300000;
  const noDelay = typeof options.noDelay === 'boolean' ? options.noDelay : true;
  const connectionTimeout =
    typeof options.connectionTimeout === 'number' ? options.connectionTimeout : 30000;
  const socketTimeout = typeof options.socketTimeout === 'number' ? options.socketTimeout : 360000;
  const rejectUnauthorized =
    typeof options.rejectUnauthorized === 'boolean' ? options.rejectUnauthorized : true;

  if (keepAliveInitialDelay > socketTimeout) {
    keepAliveInitialDelay = Math.round(socketTimeout / 2);
  }

  let socket: Socket|TLSSocket;
  const callback = function(err: Error|null|undefined, ret?: Socket|string|null) {
    if (err && socket) {
      socket.destroy();
    }
    _callback(err, ret);
  };

  try {
    if (useSsl) {
      socket = tlsConnect(parseSslOptions(family, options));
      if (typeof (socket as any).disableRenegotiation === 'function') {
        (socket as any).disableRenegotiation();
      }
    } else {
      socket = createConnection(parseConnectOptions(family, options));
    }
  } catch (err) {
    return callback(err);
  }

  socket.setKeepAlive(keepAlive, keepAliveInitialDelay);
  socket.setTimeout(connectionTimeout);
  socket.setNoDelay(noDelay);

  const errorEvents = ['error', 'close', 'timeout', 'parseError', 'connect'];
  function errorHandler(eventName: 'error'|'close'|'timeout'|'parseError') {
    return (err: Error) => {
      errorEvents.forEach(event => socket.removeAllListeners(event));
      socket.removeListener('connect', connectHandler);
      callback(connectionFailureError(eventName, err), eventName);
    };
  }

  function connectHandler() {
    errorEvents.forEach(event => socket.removeAllListeners(event));
    if ((socket as TLSSocket).authorizationError && rejectUnauthorized) {
      return callback((socket as TLSSocket).authorizationError);
    }

    socket.setTimeout(socketTimeout);
    callback(null, socket);
  }

  socket.once('error', errorHandler('error'));
  socket.once('close', errorHandler('close'));
  socket.once('timeout', errorHandler('timeout'));
  socket.once('parseError', errorHandler('parseError'));
  socket.once('connect', connectHandler);
}

const CONNECTION_ERROR_EVENTS = ['error', 'close', 'timeout', 'parseError'];
function runCommand(conn: ConnectionInterface, ns: string, command: any, options: { socketTimeout?: number }, callback: DriverCallback): void;
function runCommand(conn: ConnectionInterface, ns: string, command: any, callback: DriverCallback): void;
function runCommand(
  conn: ConnectionInterface,
  ns: string,
  command: any,
  options: { socketTimeout?: number }|DriverCallback,
  callback?: DriverCallback
): void {
  if (typeof options === 'function') (callback = options), (options = {});
  const socketTimeout = typeof options.socketTimeout === 'number' ? options.socketTimeout : 360000;
  const bson = conn.options.bson;
  const query = new Query(bson, ns, command, {
    numberToSkip: 0,
    numberToReturn: 1
  });

  function errorHandler(err: Error) {
    conn.resetSocketTimeout();
    CONNECTION_ERROR_EVENTS.forEach(eventName => conn.removeListener(eventName, errorHandler));
    conn.removeListener('message', messageHandler);
    (callback as DriverCallback)(err, null);
  }

  function messageHandler(msg: BinMsg|Response) {
    if (msg.responseTo !== query.requestId) {
      return;
    }

    conn.resetSocketTimeout();
    CONNECTION_ERROR_EVENTS.forEach(eventName => conn.removeListener(eventName, errorHandler));
    conn.removeListener('message', messageHandler);

    msg.parse({ promoteValues: true });
    (callback as DriverCallback)(null, msg.documents[0]);
  }

  conn.setSocketTimeout(socketTimeout);
  CONNECTION_ERROR_EVENTS.forEach(eventName => conn.once(eventName, errorHandler));
  conn.on('message', messageHandler);
  conn.write(query.toBin());
}

function authenticate(conn: Connection, credentials: MongoCredentials, callback: DriverCallback<Connection>) {
  const mechanism = credentials.mechanism;
  if (!AUTH_PROVIDERS[mechanism]) {
    callback(new MongoError(`authMechanism '${mechanism}' not supported`));
    return;
  }

  const provider = AUTH_PROVIDERS[mechanism];
  provider.auth(runCommand, [conn], credentials, (err: Error|null|undefined) => {
    if (err) return callback(err);
    callback(null, conn);
  });
}

function connectionFailureError(type:string, err?: Error) {
  switch (type) {
    case 'error':
      return new MongoNetworkError(err as Error);
    case 'timeout':
      return new MongoNetworkError(`connection timed out`);
    case 'close':
      return new MongoNetworkError(`connection closed`);
    default:
      return new MongoNetworkError(`unknown network error`);
  }
}
