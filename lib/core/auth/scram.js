'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const safe_buffer_1 = require("safe-buffer");
const crypto_1 = require("crypto");
const utils_1 = require("../connection/utils");
const error_1 = require("../error");
const auth_provider_1 = require("./auth_provider");
const BSON = utils_1.retrieveBSON();
const Binary = BSON.Binary;
let saslprep;
try {
    saslprep = require('saslprep');
}
catch (e) {
    // don't do anything;
}
var parsePayload = function (payload) {
    var dict = {};
    var parts = payload.split(',');
    for (var i = 0; i < parts.length; i++) {
        var valueParts = parts[i].split('=');
        dict[valueParts[0]] = valueParts[1];
    }
    return dict;
};
var passwordDigest = function (username, password) {
    if (typeof username !== 'string')
        throw new error_1.MongoError('username must be a string');
    if (typeof password !== 'string')
        throw new error_1.MongoError('password must be a string');
    if (password.length === 0)
        throw new error_1.MongoError('password cannot be empty');
    // Use node md5 generator
    var md5 = crypto_1.createHash('md5');
    // Generate keys used for authentication
    md5.update(username + ':mongo:' + password, 'utf8');
    return md5.digest('hex');
};
// XOR two buffers
function xor(a, b) {
    if (!safe_buffer_1.Buffer.isBuffer(a))
        a = safe_buffer_1.Buffer.from(a);
    if (!safe_buffer_1.Buffer.isBuffer(b))
        b = safe_buffer_1.Buffer.from(b);
    const length = Math.max(a.length, b.length);
    const res = [];
    for (let i = 0; i < length; i += 1) {
        res.push(a[i] ^ b[i]);
    }
    return safe_buffer_1.Buffer.from(res).toString('base64');
}
function H(method, text) {
    return crypto_1.createHash(method)
        .update(text)
        .digest();
}
function HMAC(method, key, text) {
    return crypto_1.createHmac(method, key)
        .update(text)
        .digest();
}
var _hiCache = {};
var _hiCacheCount = 0;
var _hiCachePurge = function () {
    _hiCache = {};
    _hiCacheCount = 0;
};
const hiLengthMap = {
    sha256: 32,
    sha1: 20
};
function HI(data, salt, iterations, cryptoMethod) {
    // omit the work if already generated
    const key = [data, salt.toString('base64'), iterations].join('_');
    if (_hiCache[key] !== undefined) {
        return _hiCache[key];
    }
    // generate the salt
    const saltedData = crypto_1.pbkdf2Sync(data, salt, iterations, hiLengthMap[cryptoMethod], cryptoMethod);
    // cache a copy to speed up the next lookup, but prevent unbounded cache growth
    if (_hiCacheCount >= 200) {
        _hiCachePurge();
    }
    _hiCache[key] = saltedData;
    _hiCacheCount += 1;
    return saltedData;
}
/**
 * Creates a new ScramSHA authentication mechanism
 * @class
 * @extends AuthProvider
 */
class ScramSHA extends auth_provider_1.AuthProvider {
    constructor(bson, cryptoMethod) {
        super(bson);
        this.cryptoMethod = cryptoMethod || 'sha1';
    }
    static _getError(err, r) {
        if (err) {
            return err;
        }
        if (r.$err || r.errmsg) {
            return new error_1.MongoError(r);
        }
    }
    /**
     * @ignore
     */
    _executeScram(sendAuthCommand, connection, credentials, nonce, callback) {
        let username = credentials.username;
        const password = credentials.password;
        const db = credentials.source;
        const cryptoMethod = this.cryptoMethod;
        let mechanism = 'SCRAM-SHA-1';
        let processedPassword;
        if (cryptoMethod === 'sha256') {
            mechanism = 'SCRAM-SHA-256';
            processedPassword = saslprep ? saslprep(password) : password;
        }
        else {
            try {
                processedPassword = passwordDigest(username, password);
            }
            catch (e) {
                return callback(e);
            }
        }
        // Clean up the user
        username = username.replace('=', '=3D').replace(',', '=2C');
        // NOTE: This is done b/c Javascript uses UTF-16, but the server is hashing in UTF-8.
        // Since the username is not sasl-prep-d, we need to do this here.
        const firstBare = safe_buffer_1.Buffer.concat([
            safe_buffer_1.Buffer.from('n=', 'utf8'),
            safe_buffer_1.Buffer.from(username, 'utf8'),
            safe_buffer_1.Buffer.from(',r=', 'utf8'),
            safe_buffer_1.Buffer.from(nonce, 'utf8')
        ]);
        // Build command structure
        const saslStartCmd = {
            saslStart: 1,
            mechanism,
            payload: new Binary(safe_buffer_1.Buffer.concat([safe_buffer_1.Buffer.from('n,,', 'utf8'), firstBare])),
            autoAuthorize: 1
        };
        // Write the commmand on the connection
        sendAuthCommand(connection, `${db}.$cmd`, saslStartCmd, (err, r) => {
            let tmpError = ScramSHA._getError(err, r);
            if (tmpError) {
                return callback(tmpError, null);
            }
            const payload = safe_buffer_1.Buffer.isBuffer(r.payload) ? new Binary(r.payload) : r.payload;
            const dict = parsePayload(payload.value());
            const iterations = parseInt(dict.i, 10);
            const salt = dict.s;
            const rnonce = dict.r;
            // Set up start of proof
            const withoutProof = `c=biws,r=${rnonce}`;
            const saltedPassword = HI(processedPassword, safe_buffer_1.Buffer.from(salt, 'base64'), iterations, cryptoMethod);
            if (iterations && iterations < 4096) {
                const error = new error_1.MongoError(`Server returned an invalid iteration count ${iterations}`);
                return callback(error, false);
            }
            const clientKey = HMAC(cryptoMethod, saltedPassword, 'Client Key');
            const storedKey = H(cryptoMethod, clientKey);
            const authMessage = [firstBare, payload.value().toString('base64'), withoutProof].join(',');
            const clientSignature = HMAC(cryptoMethod, storedKey, authMessage);
            const clientProof = `p=${xor(clientKey, clientSignature)}`;
            const clientFinal = [withoutProof, clientProof].join(',');
            const saslContinueCmd = {
                saslContinue: 1,
                conversationId: r.conversationId,
                payload: new Binary(safe_buffer_1.Buffer.from(clientFinal))
            };
            sendAuthCommand(connection, `${db}.$cmd`, saslContinueCmd, ((err, r) => {
                if (!r || r.done !== false) {
                    return callback(err, r);
                }
                const retrySaslContinueCmd = {
                    saslContinue: 1,
                    conversationId: r.conversationId,
                    payload: safe_buffer_1.Buffer.alloc(0)
                };
                sendAuthCommand(connection, `${db}.$cmd`, retrySaslContinueCmd, callback);
            }));
        });
    }
    /**
     * Implementation of authentication for a single connection
     * @override
     */
    _authenticateSingleConnection(sendAuthCommand, connection, credentials, callback) {
        // Create a random nonce
        crypto_1.randomBytes(24, (err, buff) => {
            if (err) {
                return callback(err, null);
            }
            return this._executeScram(sendAuthCommand, connection, credentials, buff.toString('base64'), callback);
        });
    }
    /**
     * Authenticate
     * @override
     * @method
     */
    auth(sendAuthCommand, connections, credentials, callback) {
        this._checkSaslprep();
        super.auth(sendAuthCommand, connections, credentials, callback);
    }
    _checkSaslprep() {
        const cryptoMethod = this.cryptoMethod;
        if (cryptoMethod === 'sha256') {
            if (!saslprep) {
                console.warn('Warning: no saslprep library specified. Passwords will not be sanitized');
            }
        }
    }
}
/**
 * Creates a new ScramSHA1 authentication mechanism
 * @class
 * @extends ScramSHA
 */
class ScramSHA1 extends ScramSHA {
    constructor(bson) {
        super(bson, 'sha1');
    }
}
exports.ScramSHA1 = ScramSHA1;
/**
 * Creates a new ScramSHA256 authentication mechanism
 * @class
 * @extends ScramSHA
 */
class ScramSHA256 extends ScramSHA {
    constructor(bson) {
        super(bson, 'sha256');
    }
}
exports.ScramSHA256 = ScramSHA256;
