"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const requireOptional = require('require_optional');
/**
 * Generate a UUIDv4
 */
function uuidV4() {
    const result = crypto_1.randomBytes(16);
    result[6] = (result[6] & 0x0f) | 0x40;
    result[8] = (result[8] & 0x3f) | 0x80;
    return result;
}
exports.uuidV4 = uuidV4;
/**
 * Returns the duration calculated from two high resolution timers in milliseconds
 *
 * @param {Object} started A high resolution timestamp created from `process.hrtime()`
 * @returns {Number} The duration in milliseconds
 */
function calculateDurationInMs(started) {
    const hrtime = process.hrtime(started);
    return (hrtime[0] * 1e9 + hrtime[1]) / 1e6;
}
exports.calculateDurationInMs = calculateDurationInMs;
/**
 * Relays events for a given listener and emitter
 *
 * @param {EventEmitter} listener the EventEmitter to listen to the events from
 * @param {EventEmitter} emitter the EventEmitter to relay the events to
 */
function relayEvents(listener, emitter, events) {
    events.forEach(eventName => listener.on(eventName, event => emitter.emit(eventName, event)));
}
exports.relayEvents = relayEvents;
function retrieveKerberos() {
    let kerberos;
    try {
        kerberos = requireOptional('kerberos');
    }
    catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            throw new Error('The `kerberos` module was not found. Please install it and try again.');
        }
        throw err;
    }
    return kerberos;
}
exports.retrieveKerberos = retrieveKerberos;
// Throw an error if an attempt to use EJSON is made when it is not installed
const noEJSONError = function () {
    throw new Error('The `mongodb-extjson` module was not found. Please install it and try again.');
};
// Facilitate loading EJSON optionally
function retrieveEJSON() {
    let EJSON = null;
    try {
        EJSON = requireOptional('mongodb-extjson');
    }
    catch (error) { } // eslint-disable-line
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
exports.retrieveEJSON = retrieveEJSON;
/**
 * A helper function for determining `maxWireVersion` between legacy and new topology
 * instances
 *
 * @private
 * @param {(Topology|Server)} topologyOrServer
 */
function maxWireVersion(topologyOrServer) {
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
function collationNotSupported(server, cmd) {
    return cmd && cmd.collation && maxWireVersion(server) < 5;
}
exports.collationNotSupported = collationNotSupported;
/**
 * Checks if a given value is a Promise
 *
 * @param {*} maybePromise
 * @return true if the provided value is a Promise
 */
function isPromiseLike(maybePromise) {
    return maybePromise && typeof maybePromise.then === 'function';
}
exports.isPromiseLike = isPromiseLike;
/**
 * Applies the function `eachFn` to each item in `arr`, in parallel.
 *
 * @param {array} arr an array of items to asynchronusly iterate over
 * @param {function} eachFn A function to call on each item of the array. The callback signature is `(item, callback)`, where the callback indicates iteration is complete.
 * @param {function} callback The callback called after every item has been iterated
 */
function eachAsync(arr, eachFn, callback) {
    if (arr.length === 0) {
        callback(null);
        return;
    }
    const length = arr.length;
    let completed = 0;
    function eachCallback(err) {
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
exports.eachAsync = eachAsync;
