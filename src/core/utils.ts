import { randomBytes } from 'crypto';
import {EventEmitter} from 'events';

const requireOptional: any = require('require_optional');

/**
 * Generate a UUIDv4
 */
export function uuidV4() {
  const result = randomBytes(16);
  result[6] = (result[6] & 0x0f) | 0x40;
  result[8] = (result[8] & 0x3f) | 0x80;
  return result;
}

/**
 * Returns the duration calculated from two high resolution timers in milliseconds
 *
 * @param {Object} started A high resolution timestamp created from `process.hrtime()`
 * @returns {Number} The duration in milliseconds
 */
export function calculateDurationInMs(started: [number, number]) {
  const hrtime = process.hrtime(started);
  return (hrtime[0] * 1e9 + hrtime[1]) / 1e6;
}

/**
 * Relays events for a given listener and emitter
 *
 * @param {EventEmitter} listener the EventEmitter to listen to the events from
 * @param {EventEmitter} emitter the EventEmitter to relay the events to
 */
export function relayEvents(listener: EventEmitter, emitter: EventEmitter, events: string[]): void {
  events.forEach(eventName => listener.on(eventName, event => emitter.emit(eventName, event)));
}

export function retrieveKerberos(): any {
  let kerberos;

  try {
    kerberos = requireOptional('kerberos');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error('The `kerberos` module was not found. Please install it and try again.');
    }

    throw err;
  }

  return kerberos;
}

// Throw an error if an attempt to use EJSON is made when it is not installed
const noEJSONError = function() {
  throw new Error('The `mongodb-extjson` module was not found. Please install it and try again.');
};

// Facilitate loading EJSON optionally
export function retrieveEJSON(): any {
  let EJSON = null;
  try {
    EJSON = requireOptional('mongodb-extjson');
  } catch (error) {} // eslint-disable-line
  if (!EJSON) {
    EJSON = {
      parse: noEJSONError,
      deserialize: noEJSONError,
      serialize: noEJSONError,
      stringify: noEJSONError,
      setBSONModule: noEJSONError,
      BSON: noEJSONError
    };
  }

  return EJSON;
}

/**
 * A helper function for determining `maxWireVersion` between legacy and new topology
 * instances
 *
 * @private
 * @param {(Topology|Server)} topologyOrServer
 */
function maxWireVersion(topologyOrServer: any) {
  if (topologyOrServer.ismaster) {
    return topologyOrServer.ismaster.maxWireVersion;
  }

  if (topologyOrServer.description) {
    return topologyOrServer.description.maxWireVersion;
  }

  return null;
}

/*
 * Checks that collation is supported by server.
 *
 * @param {Server} [server] to check against
 * @param {object} [cmd] object where collation may be specified
 * @param {function} [callback] callback function
 * @return true if server does not support collation
 */
export function collationNotSupported(server: any, cmd: any) {
  return cmd && cmd.collation && maxWireVersion(server) < 5;
}

/**
 * Checks if a given value is a Promise
 *
 * @param {*} maybePromise
 * @return true if the provided value is a Promise
 */
export function isPromiseLike(maybePromise: any): maybePromise is PromiseLike<any> {
  return maybePromise && typeof maybePromise.then === 'function';
}

/**
 * Applies the function `eachFn` to each item in `arr`, in parallel.
 *
 * @param {array} arr an array of items to asynchronusly iterate over
 * @param {function} eachFn A function to call on each item of the array. The callback signature is `(item, callback)`, where the callback indicates iteration is complete.
 * @param {function} callback The callback called after every item has been iterated
 */
export function eachAsync(
  arr: any[],
  eachFn: (x: any, y: ((...args: any[]) => any)) => any,
  callback: (err: Error|null, result?: any) => any) {
  if (arr.length === 0) {
    callback(null);
    return;
  }

  const length = arr.length;
  let completed = 0;
  function eachCallback(err?: Error) {
    if (err) {
      callback(err, null);
      return;
    }

    if (++completed === length) {
      callback(null);
    }
  }

  for (let idx = 0; idx < length; ++idx) {
    eachFn(arr[idx], eachCallback);
  }
}
