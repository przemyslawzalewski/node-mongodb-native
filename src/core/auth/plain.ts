'use strict';

import { retrieveBSON } from '../connection/utils';
import { AuthProvider } from './auth_provider';
import { RunCommandOnConnection } from '../../../interfaces/run_command_on_connection';
import { ConnectionInterface } from '../../../interfaces/connection';
import { MongoCredentials } from './mongo_credentials';
import { DriverCallback } from '../../../interfaces/driver_callback';

// TODO: can we get the Binary type from this.bson instead?
const BSON = retrieveBSON();
const Binary = BSON.Binary;

/**
 * Creates a new Plain authentication mechanism
 *
 * @extends AuthProvider
 */
export class Plain extends AuthProvider {
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
    const password = credentials.password;
    // TS-TODO: come back to this
    const payload = new Binary(`\x00${username}\x00${password}` as any);
    const command = {
      saslStart: 1,
      mechanism: 'PLAIN',
      payload: payload,
      autoAuthorize: 1
    };

    sendAuthCommand(connection, '$external.$cmd', command, callback);
  }
}

module.exports = Plain;
