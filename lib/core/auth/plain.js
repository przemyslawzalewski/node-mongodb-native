'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../connection/utils");
const auth_provider_1 = require("./auth_provider");
// TODO: can we get the Binary type from this.bson instead?
const BSON = utils_1.retrieveBSON();
const Binary = BSON.Binary;
/**
 * Creates a new Plain authentication mechanism
 *
 * @extends AuthProvider
 */
class Plain extends auth_provider_1.AuthProvider {
    /**
     * Implementation of authentication for a single connection
     * @override
     */
    _authenticateSingleConnection(sendAuthCommand, connection, credentials, callback) {
        const username = credentials.username;
        const password = credentials.password;
        // TS-TODO: come back to this
        const payload = new Binary(`\x00${username}\x00${password}`);
        const command = {
            saslStart: 1,
            mechanism: 'PLAIN',
            payload: payload,
            autoAuthorize: 1
        };
        sendAuthCommand(connection, '$external.$cmd', command, callback);
    }
}
exports.Plain = Plain;
module.exports = Plain;
