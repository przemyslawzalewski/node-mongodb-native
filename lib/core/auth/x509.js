'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const auth_provider_1 = require("./auth_provider");
/**
 * Creates a new X509 authentication mechanism
 * @class
 * @extends AuthProvider
 */
class X509 extends auth_provider_1.AuthProvider {
    /**
     * Implementation of authentication for a single connection
     * @override
     */
    _authenticateSingleConnection(sendAuthCommand, connection, credentials, callback) {
        const username = credentials.username;
        const command = { authenticate: 1, mechanism: 'MONGODB-X509' };
        if (username) {
            command.user = username;
        }
        sendAuthCommand(connection, '$external.$cmd', command, callback);
    }
}
module.exports = X509;
