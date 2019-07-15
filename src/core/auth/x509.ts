'use strict';

import { RunCommandOnConnection } from "../../../interfaces/run_command_on_connection";
import { ConnectionInterface } from "../../../interfaces/connection";
import { MongoCredentials } from "./mongo_credentials";
import { AuthProvider } from "./auth_provider";
import { DriverCallback } from '../../../interfaces/driver_callback';

/**
 * Creates a new X509 authentication mechanism
 * @class
 * @extends AuthProvider
 */
export class X509 extends AuthProvider {
  /**
   * Implementation of authentication for a single connection
   * @override
   */
  _authenticateSingleConnection(
    sendAuthCommand: RunCommandOnConnection,
    connection: ConnectionInterface, 
    credentials: MongoCredentials,
    callback: DriverCallback
  ) {
    const username = credentials.username;
    const command: any = { authenticate: 1, mechanism: 'MONGODB-X509' };
    if (username) {
      command.user = username;
    }

    sendAuthCommand(connection, '$external.$cmd', command, callback);
  }
}

module.exports = X509;
