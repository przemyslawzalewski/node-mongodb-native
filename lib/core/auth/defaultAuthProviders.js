'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const mongocr_1 = require("./mongocr");
const scram_1 = require("./scram");
const plain_1 = require("./plain");
const x509_1 = require("./x509");
// TS-TODO
const GSSAPI = require('./gssapi');
const SSPI = require('./sspi');
/**
 * Returns the default authentication providers.
 *
 * @param {BSON} bson Bson definition
 * @returns {Object} a mapping of auth names to auth types
 */
function defaultAuthProviders(bson) {
    return {
        mongocr: new mongocr_1.MongoCR(bson),
        x509: new x509_1.X509(bson),
        plain: new plain_1.Plain(bson),
        gssapi: new GSSAPI(bson),
        sspi: new SSPI(bson),
        'scram-sha-1': new scram_1.ScramSHA1(bson),
        'scram-sha-256': new scram_1.ScramSHA256(bson)
    };
}
module.exports = { defaultAuthProviders };
