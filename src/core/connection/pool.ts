"use strict";

import { EventEmitter } from "events";
import {
  MongoError,
  MongoNetworkError,
  MongoWriteConcernError
} from "../error";
import { Logger, LoggerOptions } from "./logger";
import { format as f } from "util";
import { Msg, BinMsg } from "./msg";
import { CommandResult } from "./command_result";
import {
  MESSAGE_HEADER_SIZE,
  COMPRESSION_DETAILS_SIZE,
  opcodes
} from "../wireprotocol/shared";
import { Buffer as SafeBuffer } from "safe-buffer";
import { connect } from "./connect";
import { eachAsync } from "../utils";
import { BSON } from "bson";
const compress = require("../wireprotocol/compression").compress;
const compressorIDs = require("../wireprotocol/compression").compressorIDs;
const uncompressibleCommands = require("../wireprotocol/compression")
  .uncompressibleCommands;
const apm = require("./apm");
const updateSessionFromResponse = require("../sessions")
  .updateSessionFromResponse;

const DISCONNECTED = "disconnected";
const CONNECTING = "connecting";
const CONNECTED = "connected";
const DESTROYING = "destroying";
const DESTROYED = "destroyed";

import { Connection, WorkQueueItem } from "./connection";
import { checkServerIdentity } from "tls";
import { DriverCallback } from "../../../interfaces/driver_callback";
import { Response, Query } from "./commands";
import { ClusterTime } from "../../../interfaces/ismaster";
type PoolInternalState =
  | typeof DISCONNECTED
  | typeof CONNECTING
  | typeof CONNECTED
  | typeof DESTROYING
  | typeof DESTROYED;

const CONNECTION_EVENTS = new Set([
  "error",
  "close",
  "timeout",
  "parseError",
  "connect",
  "message"
]);

var _id = 0;

type Topology = {
  clusterTime: ClusterTime;
};

export type PoolOptions = LoggerOptions & {
  bson: BSON;
  host: string;
  port: number;
  size?: number;
  minSize?: number;
  reconnect?: boolean;
  reconnectTries?: number;
  reconnectInterval?: number;
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  noDelay?: boolean;
  connectionTimeout?: number;
  socketTimeout?: number;
  monitoringSocketTimeout?: number;
  ssl?: boolean;
  checkServerIdentity?: boolean | typeof checkServerIdentity;
  ca?: Buffer;
  crl?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  passPhrase?: string;
  rejectUnauthorized?: boolean;
  promoteLongs?: boolean;
  promoteValues?: boolean;
  promoteBuffers?: boolean;
  domainsEnabled?: boolean;
  monitorCommands?: boolean;
  // This should go away:
  inTopology?: boolean;
  // What is this?
  agreedCompressor?: string;
};

export interface PoolWriteOptions {
  noResponse?: boolean;
  promoteLongs?: boolean;
  promoteValues?: boolean;
  promoteBuffers?: boolean;
  raw?: boolean;
  immediateRelease?: boolean;
  documentsReturnedIn?: string;
  command?: boolean;
  fullResult?: boolean;
  session?: unknown;
  socketTimeout?: number;
  monitoring?: boolean;
}

/**
 * Creates a new Pool instance
 * @class
 * @param {string} options.host The server host
 * @param {number} options.port The server port
 * @param {number} [options.size=5] Max server connection pool size
 * @param {number} [options.minSize=0] Minimum server connection pool size
 * @param {boolean} [options.reconnect=true] Server will attempt to reconnect on loss of connection
 * @param {number} [options.reconnectTries=30] Server attempt to reconnect #times
 * @param {number} [options.reconnectInterval=1000] Server will wait # milliseconds between retries
 * @param {boolean} [options.keepAlive=true] TCP Connection keep alive enabled
 * @param {number} [options.keepAliveInitialDelay=300000] Initial delay before TCP keep alive enabled
 * @param {boolean} [options.noDelay=true] TCP Connection no delay
 * @param {number} [options.connectionTimeout=30000] TCP Connection timeout setting
 * @param {number} [options.socketTimeout=360000] TCP Socket timeout setting
 * @param {number} [options.monitoringSocketTimeout=30000] TCP Socket timeout setting for replicaset monitoring socket
 * @param {boolean} [options.ssl=false] Use SSL for connection
 * @param {boolean|function} [options.checkServerIdentity=true] Ensure we check server identify during SSL, set to false to disable checking. Only works for Node 0.12.x or higher. You can pass in a boolean or your own checkServerIdentity override function.
 * @param {Buffer} [options.ca] SSL Certificate store binary buffer
 * @param {Buffer} [options.crl] SSL Certificate revocation store binary buffer
 * @param {Buffer} [options.cert] SSL Certificate binary buffer
 * @param {Buffer} [options.key] SSL Key file binary buffer
 * @param {string} [options.passPhrase] SSL Certificate pass phrase
 * @param {boolean} [options.rejectUnauthorized=false] Reject unauthorized server certificates
 * @param {boolean} [options.promoteLongs=true] Convert Long values from the db into Numbers if they fit into 53 bits
 * @param {boolean} [options.promoteValues=true] Promotes BSON values to native types where possible, set to false to only receive wrapper types.
 * @param {boolean} [options.promoteBuffers=false] Promotes Binary BSON values to native Node Buffers.
 * @param {boolean} [options.domainsEnabled=false] Enable the wrapping of the callback in the current domain, disabled by default to avoid perf hit.
 * @fires Pool#connect
 * @fires Pool#close
 * @fires Pool#error
 * @fires Pool#timeout
 * @fires Pool#parseError
 * @return {Pool} A cursor instance
 */
class Pool extends EventEmitter {
  // Identification information
  id = _id++;
  // Pool options
  options: PoolOptions;

  // Current reconnect retries
  retriesLeft?: number;
  reconnectId?: ReturnType<typeof setTimeout> | null = null;
  // Logger instance
  logger: Logger;
  // Pool state
  state: PoolInternalState = DISCONNECTED;

  // Connections
  availableConnections: Connection[] = [];
  inUseConnections: Connection[] = [];
  connectingConnections: number = 0;

  // Currently executing
  executing: boolean = false;
  // Operation work queue
  queue: WorkQueueItem[] = [];

  // Contains the reconnect connection
  reconnectConnection?: Connection | null;

  // Number of consecutive timeouts caught
  numberOfConsecutiveTimeouts: number = 0;
  // Current pool Index
  connectionIndex: number = 0;

  _messageHandler: (message: BinMsg | Response, connection: Connection) => void;
  _connectionCloseHandler: (err: Error) => void;
  _connectionErrorHandler: (err: Error) => void;
  _connectionTimeoutHandler: (err: Error) => void;
  _connectionParseErrorHandler: (err: Error) => void;

  constructor(public topology: Topology, options: PoolOptions) {
    super();

    // Store topology for later use
    this.topology = topology;

    // Add the options
    this.options = Object.assign(
      {
        // Host and port settings
        host: "localhost",
        port: 27017,
        // Pool default max size
        size: 5,
        // Pool default min size
        minSize: 0,
        // socket settings
        connectionTimeout: 30000,
        socketTimeout: 360000,
        keepAlive: true,
        keepAliveInitialDelay: 300000,
        noDelay: true,
        // SSL Settings
        ssl: false,
        checkServerIdentity: true,
        ca: null,
        crl: null,
        cert: null,
        key: null,
        passPhrase: null,
        rejectUnauthorized: false,
        promoteLongs: true,
        promoteValues: true,
        promoteBuffers: false,
        // Reconnection options
        reconnect: true,
        reconnectInterval: 1000,
        reconnectTries: 30,
        // Enable domains
        domainsEnabled: false
      },
      options
    );

    this.retriesLeft = this.options.reconnectTries;
    // No bson parser passed in
    if (
      !options.bson ||
      (options.bson &&
        (typeof options.bson.serialize !== "function" ||
          typeof options.bson.deserialize !== "function"))
    ) {
      throw new Error("must pass in valid bson parser");
    }

    this.logger = new Logger("Pool", options);

    // event handlers
    const pool = this;
    this._messageHandler = messageHandler(this);
    this._connectionCloseHandler = function(this: Connection, err) {
      const connection = this;
      connectionFailureHandler(pool, "close", err, connection);
    };

    this._connectionErrorHandler = function(this: Connection, err) {
      const connection = this;
      connectionFailureHandler(pool, "error", err, connection);
    };

    this._connectionTimeoutHandler = function(this: Connection, err) {
      const connection = this;
      connectionFailureHandler(pool, "timeout", err, connection);
    };

    this._connectionParseErrorHandler = function(this: Connection, err) {
      const connection = this;
      connectionFailureHandler(pool, "parseError", err, connection);
    };
  }

  get size() {
    return this.options.size;
  }

  get minSize() {
    return this.options.minSize;
  }

  get connectionTimeout() {
    return this.options.connectionTimeout;
  }

  get socketTimeout() {
    return this.options.socketTimeout;
  }

  /**
   * Return the total socket count in the pool.
   * @method
   * @return {Number} The number of socket available.
   */
  socketCount() {
    return this.availableConnections.length + this.inUseConnections.length;
    // + this.connectingConnections.length;
  }

  /**
   * Return all pool connections
   * @method
   * @return {Connection[]} The pool connections
   */
  allConnections() {
    return this.availableConnections.concat(this.inUseConnections);
  }

  /**
   * Get a pool connection (round-robin)
   * @method
   * @return {Connection}
   */
  get() {
    return this.allConnections()[0];
  }

  /**
   * Is the pool connected
   * @method
   * @return {boolean}
   */
  isConnected() {
    // We are in a destroyed state
    if (this.state === DESTROYED || this.state === DESTROYING) {
      return false;
    }

    // Get connections
    var connections = this.availableConnections.concat(this.inUseConnections);

    // Check if we have any connected connections
    for (var i = 0; i < connections.length; i++) {
      if (connections[i].isConnected()) return true;
    }

    // Not connected
    return false;
  }

  /**
   * Was the pool destroyed
   * @method
   * @return {boolean}
   */
  isDestroyed() {
    return this.state === DESTROYED || this.state === DESTROYING;
  }

  /**
   * Is the pool in a disconnected state
   * @method
   * @return {boolean}
   */
  isDisconnected() {
    return this.state === DISCONNECTED;
  }

  /**
   * Connect pool
   */
  connect() {
    if (this.state !== DISCONNECTED) {
      throw new MongoError("connection in unlawful state " + this.state);
    }

    const self = this;
    stateTransition(this, CONNECTING);

    self.connectingConnections++;
    connect(self.options, (err, connection) => {
      self.connectingConnections--;

      // TS-TODO: type guard?
      if (err) {
        if (self.logger.isDebug()) {
          self.logger.debug(
            `connection attempt failed with error [${JSON.stringify(err)}]`
          );
        }

        if (self.state === CONNECTING) {
          self.emit("error", err);
        }

        return;
      }

      if (self.state === DESTROYED || self.state === DESTROYING) {
        return self.destroy();
      }

      // attach event handlers
      (connection as Connection).on("error", self._connectionErrorHandler);
      (connection as Connection).on("close", self._connectionCloseHandler);
      (connection as Connection).on("timeout", self._connectionTimeoutHandler);
      (connection as Connection).on(
        "parseError",
        self._connectionParseErrorHandler
      );
      (connection as Connection).on("message", self._messageHandler);

      // If we are in a topology, delegate the auth to it
      // This is to avoid issues where we would auth against an
      // arbiter
      if (self.options.inTopology) {
        stateTransition(self, CONNECTED);
        self.availableConnections.push(connection as Connection);
        return self.emit("connect", self, connection);
      }

      stateTransition(self, CONNECTED);
      self.availableConnections.push(connection as Connection);

      if (self.minSize) {
        for (let i = 0; i < self.minSize; i++) {
          _createConnection(self);
        }
      }

      self.emit("connect", self, connection);
    });
  }

  /**
   * Authenticate using a specified mechanism
   * @param {authResultCallback} callback A callback function
   */
  auth(credentials: any, callback: any) {
    if (typeof callback === "function") callback(null, null);
  }

  /**
   * Logout all users against a database
   * @param {authResultCallback} callback A callback function
   */
  logout(dbName: any, callback: any) {
    if (typeof callback === "function") callback(null, null);
  }

  /**
   * Unref the pool
   * @method
   */
  unref() {
    // Get all the known connections
    var connections = this.availableConnections.concat(this.inUseConnections);

    connections.forEach(function(c) {
      c.unref();
    });
  }

  /**
   * Destroy pool
   * @method
   */
  destroy(force?: boolean, callback?: DriverCallback) {
    var self = this;
    // Do not try again if the pool is already dead
    if (this.state === DESTROYED || self.state === DESTROYING) {
      if (typeof callback === "function") callback(null, null);
      return;
    }

    // Set state to destroyed
    stateTransition(this, DESTROYING);

    // Are we force closing
    if (force) {
      // Get all the known connections
      var connections = self.availableConnections.concat(self.inUseConnections);

      // Flush any remaining work items with
      // an error
      while (self.queue.length > 0) {
        var workItem = self.queue.shift() as WorkQueueItem;
        if (typeof workItem.cb === "function") {
          workItem.cb(new MongoError("Pool was force destroyed"));
        }
      }

      // Destroy the topology
      return destroy(self, connections, { force: true }, callback);
    }

    // Clear out the reconnect if set
    if (this.reconnectId) {
      clearTimeout(this.reconnectId);
    }

    // If we have a reconnect connection running, close
    // immediately
    if (this.reconnectConnection) {
      this.reconnectConnection.destroy();
    }

    // Wait for the operations to drain before we close the pool
    function checkStatus() {
      flushMonitoringOperations(self.queue);

      if (self.queue.length === 0) {
        // Get all the known connections
        var connections = self.availableConnections.concat(
          self.inUseConnections
        );

        // Check if we have any in flight operations
        for (var i = 0; i < connections.length; i++) {
          // There is an operation still in flight, reschedule a
          // check waiting for it to drain
          if (connections[i].workItems.length > 0) {
            return setTimeout(checkStatus, 1);
          }
        }

        destroy(self, connections, { force: false }, callback);
        // } else if (self.queue.length > 0 && !this.reconnectId) {
      } else {
        // Ensure we empty the queue
        _execute(self)();
        // Set timeout
        setTimeout(checkStatus, 1);
      }
    }

    // Initiate drain of operations
    checkStatus();
  }

  /**
   * Reset all connections of this pool
   *
   * @param {function} [callback]
   */
  reset(callback: DriverCallback<null>) {
    const connections = this.availableConnections.concat(this.inUseConnections);
    eachAsync(
      connections,
      (conn, cb) => {
        for (const eventName of CONNECTION_EVENTS) {
          conn.removeAllListeners(eventName);
        }

        conn.destroy({ force: true }, cb);
      },
      err => {
        if (err) {
          if (typeof callback === "function") {
            callback(err, null);
            return;
          }
        }

        resetPoolState(this);

        // create an initial connection, and kick off execution again
        _createConnection(this);

        if (typeof callback === "function") {
          callback(null, null);
        }
      }
    );
  }

  /**
   * Write a message to MongoDB
   * @method
   * @return {Connection}
   */
  write(command: any, options: PoolWriteOptions, cb: DriverCallback<any>) {
    var self = this;
    // Ensure we have a callback
    if (typeof options === "function") {
      cb = options;
    }

    // Always have options
    options = options || {};

    // We need to have a callback function unless the message returns no response
    if (!(typeof cb === "function") && !options.noResponse) {
      throw new MongoError("write method must provide a callback");
    }

    // Pool was destroyed error out
    if (this.state === DESTROYED || this.state === DESTROYING) {
      // Callback with an error
      if (cb) {
        try {
          cb(new MongoError("pool destroyed"));
        } catch (err) {
          process.nextTick(function() {
            throw err;
          });
        }
      }

      return;
    }

    if (
      this.options.domainsEnabled &&
      process.domain &&
      typeof cb === "function"
    ) {
      // if we have a domain bind to it
      var oldCb = cb;
      cb = process.domain.bind(function() {
        // v8 - argumentsToArray one-liner
        var args = new Array(arguments.length);
        for (var i = 0; i < arguments.length; i++) {
          args[i] = arguments[i];
        }
        // bounce off event loop so domain switch takes place
        process.nextTick(function() {
          // @ts-ignore
          oldCb.apply(null, args);
        });
      });
    }

    // Do we have an operation
    var operation: WorkQueueItem = {
      cb: cb,
      raw: false,
      promoteLongs: true,
      promoteValues: true,
      promoteBuffers: false,
      fullResult: false,
      socketTimeout: options.socketTimeout,
      session: options.session,
      monitoring: options.monitoring,
      documentsReturnedIn: options.documentsReturnedIn
    } as WorkQueueItem;

    // Set the options for the parsing
    operation.promoteLongs =
      typeof options.promoteLongs === "boolean" ? options.promoteLongs : true;
    operation.promoteValues =
      typeof options.promoteValues === "boolean" ? options.promoteValues : true;
    operation.promoteBuffers =
      typeof options.promoteBuffers === "boolean"
        ? options.promoteBuffers
        : false;
    operation.raw = typeof options.raw === "boolean" ? options.raw : false;
    operation.immediateRelease =
      typeof options.immediateRelease === "boolean"
        ? options.immediateRelease
        : false;
    operation.documentsReturnedIn = options.documentsReturnedIn;
    operation.command =
      typeof options.command === "boolean" ? options.command : false;
    operation.fullResult =
      typeof options.fullResult === "boolean" ? options.fullResult : false;
    operation.noResponse =
      typeof options.noResponse === "boolean" ? options.noResponse : false;

    // Get the requestId
    operation.requestId = command.requestId;

    // If command monitoring is enabled we need to modify the callback here
    if (self.options.monitorCommands) {
      this.emit("commandStarted", new apm.CommandStartedEvent(this, command));

      operation.started = process.hrtime();
      operation.cb = (err, reply) => {
        if (err) {
          self.emit(
            "commandFailed",
            new apm.CommandFailedEvent(this, command, err, operation.started)
          );
        } else {
          if (
            reply &&
            reply.result &&
            (reply.result.ok === 0 || reply.result.$err)
          ) {
            self.emit(
              "commandFailed",
              new apm.CommandFailedEvent(
                this,
                command,
                reply.result,
                operation.started
              )
            );
          } else {
            self.emit(
              "commandSucceeded",
              new apm.CommandSucceededEvent(
                this,
                command,
                reply,
                operation.started
              )
            );
          }
        }

        if (typeof cb === "function") cb(err, reply);
      };
    }

    // Prepare the operation buffer
    serializeCommand(self, command, (err, serializedBuffers) => {
      if (err) throw err;

      // Set the operation's buffer to the serialization of the commands
      operation.buffer = (serializedBuffers as Buffer|undefined);

      // If we have a monitoring operation schedule as the very first operation
      // Otherwise add to back of queue
      if (options.monitoring) {
        self.queue.unshift(operation);
      } else {
        self.queue.push(operation);
      }

      // Attempt to execute the operation
      if (!self.executing) {
        process.nextTick(function() {
          _execute(self)();
        });
      }
    });
  }

  // Make execution loop available for testing
  static _execute: any;
}

Pool._execute = _execute;

// clears all pool state
function resetPoolState(pool: Pool) {
  pool.inUseConnections = [];
  pool.availableConnections = [];
  pool.connectingConnections = 0;
  pool.executing = false;
  pool.reconnectConnection = undefined;
  pool.numberOfConsecutiveTimeouts = 0;
  pool.connectionIndex = 0;
  pool.retriesLeft = pool.options.reconnectTries;
  pool.reconnectId = undefined;
}

function stateTransition(self: Pool, newState: PoolInternalState) {
  var legalTransitions = {
    disconnected: [CONNECTING, DESTROYING, DISCONNECTED],
    connecting: [CONNECTING, DESTROYING, CONNECTED, DISCONNECTED],
    connected: [CONNECTED, DISCONNECTED, DESTROYING],
    destroying: [DESTROYING, DESTROYED],
    destroyed: [DESTROYED]
  };

  // Get current state
  var legalStates = legalTransitions[self.state];
  if (legalStates && legalStates.indexOf(newState) !== -1) {
    self.emit("stateChanged", self.state, newState);
    self.state = newState;
  } else {
    self.logger.error(
      f(
        "Pool with id [%s] failed attempted illegal state transition from [%s] to [%s] only following state allowed [%s]",
        self.id,
        self.state,
        newState,
        legalStates
      )
    );
  }
}

function connectionFailureHandler(
  pool: Pool,
  event: string,
  err: Error | undefined,
  conn?: Connection
) {
  if (conn) {
    // TS-TODO: deal with this
    if ((conn as any)._connectionFailHandled) return;
    (conn as any)._connectionFailHandled = true;
    conn.destroy();

    // Remove the connection
    removeConnection(pool, conn);

    // Flush all work Items on this connection
    while (conn.workItems.length > 0) {
      const workItem = conn.workItems.shift() as WorkQueueItem;
      if (workItem.cb) workItem.cb(err);
    }
  }

  // Did we catch a timeout, increment the numberOfConsecutiveTimeouts
  if (event === "timeout") {
    pool.numberOfConsecutiveTimeouts = pool.numberOfConsecutiveTimeouts + 1;

    // Have we timed out more than reconnectTries in a row ?
    // Force close the pool as we are trying to connect to tcp sink hole
    if (
      pool.numberOfConsecutiveTimeouts > (pool.options.reconnectTries as number)
    ) {
      pool.numberOfConsecutiveTimeouts = 0;
      // Destroy all connections and pool
      pool.destroy(true);
      // Emit close event
      return pool.emit("close", pool);
    }
  }

  // No more socket available propegate the event
  if (pool.socketCount() === 0) {
    if (pool.state !== DESTROYED && pool.state !== DESTROYING) {
      stateTransition(pool, DISCONNECTED);
    }

    // Do not emit error events, they are always close events
    // do not trigger the low level error handler in node
    event = event === "error" ? "close" : event;
    pool.emit(event, err);
  }

  // Start reconnection attempts
  if (!pool.reconnectId && pool.options.reconnect) {
    pool.reconnectId = setTimeout(attemptReconnect(pool), pool.options
      .reconnectInterval as number);
  }

  // Do we need to do anything to maintain the minimum pool size
  const totalConnections = totalConnectionCount(pool);
  if (totalConnections < (pool.minSize as number)) {
    _createConnection(pool);
  }
}

function attemptReconnect(self: Pool) {
  return function() {
    self.emit("attemptReconnect", self);
    if (self.state === DESTROYED || self.state === DESTROYING) return;

    // We are connected do not try again
    if (self.isConnected()) {
      self.reconnectId = null;
      return;
    }

    self.connectingConnections++;
    connect(self.options, (err, connection) => {
      self.connectingConnections--;

      if (err) {
        if (self.logger.isDebug()) {
          self.logger.debug(
            `connection attempt failed with error [${JSON.stringify(err)}]`
          );
        }

        self.retriesLeft = (self.retriesLeft as number) - 1;
        if (self.retriesLeft <= 0) {
          self.destroy();
          self.emit(
            "reconnectFailed",
            new MongoNetworkError(
              f(
                "failed to reconnect after %s attempts with interval %s ms",
                self.options.reconnectTries,
                self.options.reconnectInterval
              )
            )
          );
        } else {
          self.reconnectId = setTimeout(attemptReconnect(self), self.options
            .reconnectInterval as number);
        }

        return;
      }

      if (self.state === DESTROYED || self.state === DESTROYING) {
        return (connection as Connection).destroy();
      }

      self.reconnectId = null;
      handlers.forEach(event =>
        (connection as Connection).removeAllListeners(event)
      );
      (connection as Connection).on("error", self._connectionErrorHandler);
      (connection as Connection).on("close", self._connectionCloseHandler);
      (connection as Connection).on("timeout", self._connectionTimeoutHandler);
      (connection as Connection).on(
        "parseError",
        self._connectionParseErrorHandler
      );
      (connection as Connection).on("message", self._messageHandler);

      self.retriesLeft = self.options.reconnectTries;
      self.availableConnections.push(connection as Connection);
      self.reconnectConnection = null;
      self.emit("reconnect", self);
      _execute(self)();
    });
  };
}

function moveConnectionBetween(
  connection: Connection,
  from: Connection[],
  to: Connection[]
) {
  var index = from.indexOf(connection);
  // Move the connection from connecting to available
  if (index !== -1) {
    from.splice(index, 1);
    to.push(connection);
  }
}

function messageHandler(self: Pool) {
  return function(message: BinMsg | Response, connection: Connection) {
    // workItem to execute
    var workItem = null;

    // Locate the workItem
    for (var i = 0; i < connection.workItems.length; i++) {
      if (connection.workItems[i].requestId === message.responseTo) {
        // Get the callback
        workItem = connection.workItems[i];
        // Remove from list of workItems
        connection.workItems.splice(i, 1);
      }
    }

    if (workItem && workItem.monitoring) {
      moveConnectionBetween(
        connection,
        self.inUseConnections,
        self.availableConnections
      );
    }

    // Reset timeout counter
    self.numberOfConsecutiveTimeouts = 0;

    // Reset the connection timeout if we modified it for
    // this operation
    if (workItem && workItem.socketTimeout) {
      connection.resetSocketTimeout();
    }

    // Log if debug enabled
    if (self.logger.isDebug()) {
      self.logger.debug(
        f(
          "message [%s] received from %s:%s",
          message.raw.toString("hex"),
          self.options.host,
          self.options.port
        )
      );
    }

    function handleOperationCallback(
      self: Pool,
      cb: DriverCallback,
      err: Error | null | undefined,
      result?: any
    ) {
      // No domain enabled
      if (!self.options.domainsEnabled) {
        return process.nextTick(function() {
          return cb(err, result);
        });
      }

      // Domain enabled just call the callback
      cb(err, result);
    }

    // Keep executing, ensure current message handler does not stop execution
    if (!self.executing) {
      process.nextTick(function() {
        _execute(self)();
      });
    }

    // Time to dispatch the message if we have a callback
    if (workItem && !workItem.immediateRelease) {
      try {
        // Parse the message according to the provided options
        message.parse(workItem);
      } catch (err) {
        return handleOperationCallback(self, workItem.cb, new MongoError(err));
      }

      if (message.documents[0]) {
        const document = message.documents[0];
        const session = workItem.session;
        if (session) {
          updateSessionFromResponse(session, document);
        }

        if (document.$clusterTime) {
          self.topology.clusterTime = document.$clusterTime;
        }
      }

      // Establish if we have an error
      if (workItem.command && message.documents[0]) {
        const responseDoc = message.documents[0];

        if (responseDoc.writeConcernError) {
          const err = new MongoWriteConcernError(
            responseDoc.writeConcernError,
            responseDoc
          );
          return handleOperationCallback(self, workItem.cb, err);
        }

        if (
          responseDoc.ok === 0 ||
          responseDoc.$err ||
          responseDoc.errmsg ||
          responseDoc.code
        ) {
          return handleOperationCallback(
            self,
            workItem.cb,
            new MongoError(responseDoc)
          );
        }
      }

      // Add the connection details
      message.hashedName = connection.hashedName;

      // Return the documents
      handleOperationCallback(
        self,
        workItem.cb,
        null,
        new CommandResult(
          workItem.fullResult ? message : message.documents[0],
          connection,
          message
        )
      );
    }
  };
}

function totalConnectionCount(pool: Pool) {
  return (
    pool.availableConnections.length +
    pool.inUseConnections.length +
    pool.connectingConnections
  );
}

// Destroy the connections
function destroy(
  self: Pool,
  connections: Connection[],
  options?: any,
  callback?: DriverCallback<null>
) {
  eachAsync(
    connections,
    (conn: Connection, cb) => {
      for (const eventName of CONNECTION_EVENTS) {
        conn.removeAllListeners(eventName);
      }

      conn.destroy(options, cb);
    },
    err => {
      if (err) {
        if (typeof callback === "function") callback(err, null);
        return;
      }

      resetPoolState(self);
      self.queue = [];

      stateTransition(self, DESTROYED);
      if (typeof callback === "function") callback(null, null);
    }
  );
}

// Prepare the buffer that Pool.prototype.write() uses to send to the server
function serializeCommand(self: Pool, command: any, callback: DriverCallback<Buffer[]>) {
  const originalCommandBuffer = command.toBin();

  // Check whether we and the server have agreed to use a compressor
  const shouldCompress = !!self.options.agreedCompressor;
  if (!shouldCompress || !canCompress(command)) {
    return callback(null, originalCommandBuffer);
  }

  // Transform originalCommandBuffer into OP_COMPRESSED
  const concatenatedOriginalCommandBuffer = SafeBuffer.concat(
    originalCommandBuffer
  );
  const messageToBeCompressed = concatenatedOriginalCommandBuffer.slice(
    MESSAGE_HEADER_SIZE
  );

  // Extract information needed for OP_COMPRESSED from the uncompressed message
  const originalCommandOpCode = concatenatedOriginalCommandBuffer.readInt32LE(
    12
  );

  // Compress the message body
  compress(self, messageToBeCompressed, function(err: Error|undefined, compressedMessage: Buffer|undefined) {
    if (err) return callback(err, null);

    // Create the msgHeader of OP_COMPRESSED
    const msgHeader = SafeBuffer.alloc(MESSAGE_HEADER_SIZE);
    msgHeader.writeInt32LE(
      MESSAGE_HEADER_SIZE + COMPRESSION_DETAILS_SIZE + (compressedMessage as Buffer).length,
      0
    ); // messageLength
    msgHeader.writeInt32LE(command.requestId, 4); // requestID
    msgHeader.writeInt32LE(0, 8); // responseTo (zero)
    msgHeader.writeInt32LE(opcodes.OP_COMPRESSED, 12); // opCode

    // Create the compression details of OP_COMPRESSED
    const compressionDetails = SafeBuffer.alloc(COMPRESSION_DETAILS_SIZE);
    compressionDetails.writeInt32LE(originalCommandOpCode, 0); // originalOpcode
    compressionDetails.writeInt32LE(messageToBeCompressed.length, 4); // Size of the uncompressed compressedMessage, excluding the MsgHeader
    compressionDetails.writeUInt8(
      compressorIDs[self.options.agreedCompressor as string],
      8
    ); // compressorID

    return callback(null, [(msgHeader as unknown as Buffer), (compressionDetails as unknown as Buffer), (compressedMessage as Buffer)]);
  });
}

// Return whether a command contains an uncompressible command term
// Will return true if command contains no uncompressible command terms
function canCompress(command: Msg|Query) {
  const commandDoc = command instanceof Msg ? command.command : command.query;
  const commandName = Object.keys(commandDoc)[0];
  return uncompressibleCommands.indexOf(commandName) === -1;
}

// Remove connection method
function remove(connection: Connection, connections: Connection[]) {
  for (var i = 0; i < connections.length; i++) {
    if (connections[i] === connection) {
      connections.splice(i, 1);
      return true;
    }
  }
}

function removeConnection(self: Pool, connection: Connection) {
  if (remove(connection, self.availableConnections)) return;
  if (remove(connection, self.inUseConnections)) return;
}

const handlers = [
  "close",
  "message",
  "error",
  "timeout",
  "parseError",
  "connect"
];
function _createConnection(self: Pool) {
  if (self.state === DESTROYED || self.state === DESTROYING) {
    return;
  }

  self.connectingConnections++;
  connect(self.options, (err, connection) => {
    self.connectingConnections--;

    if (err) {
      if (self.logger.isDebug()) {
        self.logger.debug(
          `connection attempt failed with error [${JSON.stringify(err)}]`
        );
      }

      if (!self.reconnectId && self.options.reconnect) {
        self.reconnectId = setTimeout(
          attemptReconnect(self),
          (self.options.reconnectInterval as number)
        );
      }

      return;
    }

    if (self.state === DESTROYED || self.state === DESTROYING) {
      removeConnection(self, (connection as Connection));
      return (connection as Connection).destroy();
    }

    (connection as Connection).on("error", self._connectionErrorHandler);
    (connection as Connection).on("close", self._connectionCloseHandler);
    (connection as Connection).on("timeout", self._connectionTimeoutHandler);
    (connection as Connection).on("parseError", self._connectionParseErrorHandler);
    (connection as Connection).on("message", self._messageHandler);

    // Remove the connection from the connectingConnections list
    removeConnection(self, (connection as Connection));


    // Push to available
    self.availableConnections.push((connection as Connection));
    // Execute any work waiting
    _execute(self)();
  });
}

function flushMonitoringOperations(queue: WorkQueueItem[]) {
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].monitoring) {
      var workItem = queue[i];
      queue.splice(i, 1);
      workItem.cb(
        new MongoError({
          message: "no connection available for monitoring",
          driver: true
        })
      );
    }
  }
}

function _execute(self: Pool) {
  return function() {
    if (self.state === DESTROYED) return;
    // Already executing, skip
    if (self.executing) return;
    // Set pool as executing
    self.executing = true;

    // New pool connections are in progress, wait them to finish
    // before executing any more operation to ensure distribution of
    // operations
    if (self.connectingConnections > 0) {
      self.executing = false;
      return;
    }

    // As long as we have available connections
    // eslint-disable-next-line
    while (true) {
      // Total availble connections
      const totalConnections = totalConnectionCount(self);

      // No available connections available, flush any monitoring ops
      if (self.availableConnections.length === 0) {
        // Flush any monitoring operations
        flushMonitoringOperations(self.queue);
        break;
      }

      // No queue break
      if (self.queue.length === 0) {
        break;
      }

      var connection = null;
      const connections = self.availableConnections.filter(
        conn => conn.workItems.length === 0
      );

      // No connection found that has no work on it, just pick one for pipelining
      if (connections.length === 0) {
        connection =
          self.availableConnections[
            self.connectionIndex++ % self.availableConnections.length
          ];
      } else {
        connection = connections[self.connectionIndex++ % connections.length];
      }

      // Is the connection connected
      if (!connection.isConnected()) {
        // Remove the disconnected connection
        removeConnection(self, connection);
        // Flush any monitoring operations in the queue, failing fast
        flushMonitoringOperations(self.queue);
        break;
      }

      // Get the next work item
      var workItem = self.queue.shift() as WorkQueueItem;

      // If we are monitoring we need to use a connection that is not
      // running another operation to avoid socket timeout changes
      // affecting an existing operation
      if (workItem.monitoring) {
        var foundValidConnection = false;

        for (let i = 0; i < self.availableConnections.length; i++) {
          // If the connection is connected
          // And there are no pending workItems on it
          // Then we can safely use it for monitoring.
          if (
            self.availableConnections[i].isConnected() &&
            self.availableConnections[i].workItems.length === 0
          ) {
            foundValidConnection = true;
            connection = self.availableConnections[i];
            break;
          }
        }

        // No safe connection found, attempt to grow the connections
        // if possible and break from the loop
        if (!foundValidConnection) {
          // Put workItem back on the queue
          self.queue.unshift(workItem);

          // Attempt to grow the pool if it's not yet maxsize
          if (totalConnections < (self.options.size as number) && self.queue.length > 0) {
            // Create a new connection
            _createConnection(self);
          }

          // Re-execute the operation
          setTimeout(function() {
            _execute(self)();
          }, 10);

          break;
        }
      }

      // Don't execute operation until we have a full pool
      if (totalConnections < (self.options.size as number)) {
        // Connection has work items, then put it back on the queue
        // and create a new connection
        if (connection.workItems.length > 0) {
          // Lets put the workItem back on the list
          self.queue.unshift(workItem);
          // Create a new connection
          _createConnection(self);
          // Break from the loop
          break;
        }
      }

      // Get actual binary commands
      var buffer = workItem.buffer;

      // If we are monitoring take the connection of the availableConnections
      if (workItem.monitoring) {
        moveConnectionBetween(
          connection,
          self.availableConnections,
          self.inUseConnections
        );
      }

      // Track the executing commands on the mongo server
      // as long as there is an expected response
      if (!workItem.noResponse) {
        connection.workItems.push(workItem);
      }

      // We have a custom socketTimeout
      if (
        !workItem.immediateRelease &&
        typeof workItem.socketTimeout === "number"
      ) {
        connection.setSocketTimeout(workItem.socketTimeout);
      }

      // Capture if write was successful
      var writeSuccessful = true;

      // Put operation on the wire
      if (Array.isArray(buffer)) {
        for (let i = 0; i < buffer.length; i++) {
          writeSuccessful = connection.write(buffer[i]);
        }
      } else {
        writeSuccessful = connection.write(buffer as Buffer);
      }

      // if the command is designated noResponse, call the callback immeditely
      if (workItem.noResponse && typeof workItem.cb === "function") {
        workItem.cb(null, null);
      }

      if (writeSuccessful === false) {
        // If write not successful put back on queue
        self.queue.unshift(workItem);
        // Remove the disconnected connection
        removeConnection(self, connection);
        // Flush any monitoring operations in the queue, failing fast
        flushMonitoringOperations(self.queue);
        break;
      }
    }

    self.executing = false;
  };
}

/**
 * A server connect event, used to verify that the connection is up and running
 *
 * @event Pool#connect
 * @type {Pool}
 */

/**
 * A server reconnect event, used to verify that pool reconnected.
 *
 * @event Pool#reconnect
 * @type {Pool}
 */

/**
 * The server connection closed, all pool connections closed
 *
 * @event Pool#close
 * @type {Pool}
 */

/**
 * The server connection caused an error, all pool connections closed
 *
 * @event Pool#error
 * @type {Pool}
 */

/**
 * The server connection timed out, all pool connections closed
 *
 * @event Pool#timeout
 * @type {Pool}
 */

/**
 * The driver experienced an invalid message, all pool connections closed
 *
 * @event Pool#parseError
 * @type {Pool}
 */

/**
 * The driver attempted to reconnect
 *
 * @event Pool#attemptReconnect
 * @type {Pool}
 */

/**
 * The driver exhausted all reconnect attempts
 *
 * @event Pool#reconnectFailed
 * @type {Pool}
 */

module.exports = Pool;
