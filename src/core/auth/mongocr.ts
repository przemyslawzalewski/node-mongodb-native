'use strict';

import { createHash } from 'crypto';
import { AuthProvider } from './auth_provider';
import { MongoCredentials } from './mongo_credentials';
import { ConnectionInterface } from '../../../interfaces/connection';
import { RunCommandOnConnection } from '../../../interfaces/run_command_on_connection';
import { DriverCallback } from '../../../interfaces/driver_callback';

/**
 * Creates a new MongoCR authentication mechanism
 *
 * @extends AuthProvider
 */
export class MongoCR extends AuthProvider {
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
    const source = credentials.source;

    sendAuthCommand(connection, `${source}.$cmd`, { getnonce: 1 }, (err: Error|null|undefined, r: any) => {
      let nonce = null;
      let key = null;

      // Get nonce
      if (err == null) {
        nonce = r.nonce;
        // Use node md5 generator
        let md5 = createHash('md5');
        // Generate keys used for authentication
        md5.update(username + ':mongo:' + password, 'utf8');
        const hash_password = md5.digest('hex');
        // Final key
        md5 = createHash('md5');
        md5.update(nonce + username + hash_password, 'utf8');
        key = md5.digest('hex');
      }

      const authenticateCommand = {
        authenticate: 1,
        user: username,
        nonce,
        key
      };

      sendAuthCommand(connection, `${source}.$cmd`, authenticateCommand, callback);
    });
  }
}
