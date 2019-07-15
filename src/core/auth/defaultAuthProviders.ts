'use strict';

import { BSON } from 'bson';
import { MongoCR } from "./mongocr";
import { ScramSHA1, ScramSHA256 } from "./scram";
import { Plain } from "./plain";
import { X509 } from "./x509";
import { AuthProvider } from "./auth_provider";

// TS-TODO
const GSSAPI: typeof AuthProvider = require('./gssapi');
const SSPI: typeof AuthProvider = require('./sspi');


/**
 * Returns the default authentication providers.
 *
 * @param {BSON} bson Bson definition
 * @returns {Object} a mapping of auth names to auth types
 */
export function defaultAuthProviders(bson: BSON) {
  return {
    mongocr: new MongoCR(bson),
    x509: new X509(bson),
    plain: new Plain(bson),
    gssapi: new GSSAPI(bson),
    sspi: new SSPI(bson),
    'scram-sha-1': new ScramSHA1(bson),
    'scram-sha-256': new ScramSHA256(bson)
  };
}

module.exports = { defaultAuthProviders };
