"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const require_optional = require('require_optional');
function debugOptions(debugFields, options) {
    const finaloptions = {};
    debugFields.forEach(function (n) {
        finaloptions[n] = options[n];
    });
    return finaloptions;
}
exports.debugOptions = debugOptions;
function retrieveBSON() {
    var BSON = require('bson');
    BSON.native = false;
    try {
        var optionalBSON = require_optional('bson-ext');
        if (optionalBSON) {
            optionalBSON.native = true;
            return optionalBSON;
        }
    }
    catch (err) { } // eslint-disable-line
    return BSON;
}
exports.retrieveBSON = retrieveBSON;
// Throw an error if an attempt to use Snappy is made when Snappy is not installed
function noSnappyWarning() {
    throw new Error('Attempted to use Snappy compression, but Snappy is not installed. Install or disable Snappy compression and try again.');
}
// Facilitate loading Snappy optionally
function retrieveSnappy() {
    var snappy = null;
    try {
        snappy = require_optional('snappy');
    }
    catch (error) { } // eslint-disable-line
    if (!snappy) {
        snappy = {
            compress: noSnappyWarning,
            uncompress: noSnappyWarning,
            compressSync: noSnappyWarning,
            uncompressSync: noSnappyWarning
        };
    }
    return snappy;
}
exports.retrieveSnappy = retrieveSnappy;
