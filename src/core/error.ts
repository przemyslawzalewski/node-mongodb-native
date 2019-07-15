'use strict';

export const mongoErrorContextSymbol = Symbol('mongoErrorContextSymbol');

/**
 * Creates a new MongoError
 *
 * @augments Error
 * @param {Error|string|object} message The error message
 * @property {string} message The error message
 * @property {string} stack The error call stack
 */
export class MongoError extends Error {
  errorLabels?: string[];
  [mongoErrorContextSymbol]: Record<string, any>;
  constructor(message: Error|string|Record<string,any>) {
    if (message instanceof Error) {
      super(message.message);
      this.stack = message.stack;
    } else {
      if (typeof message === 'string') {
        super(message);
      } else {
        super(message.message || message.errmsg || message.$err || 'n/a');
        for (var name in message) {
          (this as any)[name] = message[name];
        }
      }

      Error.captureStackTrace(this, this.constructor);
    }

    this.name = 'MongoError';
    this[mongoErrorContextSymbol] = this[mongoErrorContextSymbol] || {};
  }

  /**
   * Creates a new MongoError object
   *
   * @param {Error|string|object} options The options used to create the error.
   * @return {MongoError} A MongoError instance
   * @deprecated Use `new MongoError()` instead.
   */
  static create(options: ConstructorParameters<typeof MongoError>[0]) {
    return new MongoError(options);
  }

  hasErrorLabel(label:string) {
    return this.errorLabels && this.errorLabels.indexOf(label) !== -1;
  }
}

/**
 * Creates a new MongoNetworkError
 *
 * @param {Error|string|object} message The error message
 * @property {string} message The error message
 * @property {string} stack The error call stack
 */
export class MongoNetworkError extends MongoError {
  constructor(message: ConstructorParameters<typeof MongoError>) {
    super(message);
    this.name = 'MongoNetworkError';

    // This is added as part of the transactions specification
    this.errorLabels = ['TransientTransactionError'];
  }
}

/**
 * An error used when attempting to parse a value (like a connection string)
 *
 * @param {Error|string|object} message The error message
 * @property {string} message The error message
 */
export class MongoParseError extends MongoError {
  constructor(message: ConstructorParameters<typeof MongoError>) {
    super(message);
    this.name = 'MongoParseError';
  }
}

/**
 * An error signifying a timeout event
 *
 * @param {Error|string|object} message The error message
 * @property {string} message The error message
 */
export class MongoTimeoutError extends MongoError {
  constructor(message: ConstructorParameters<typeof MongoError>) {
    super(message);
    this.name = 'MongoTimeoutError';
  }
}

function makeWriteConcernResultObject<T extends { ok: 1 }>(input: T): T;
function makeWriteConcernResultObject<T extends { ok: 0 }>(input: T): Omit<T, 'ok'|'errmsg'|'code'|'codeName'> & { ok: 1 }
function makeWriteConcernResultObject(input: any) {
  const output = Object.assign({}, input);

  if (output.ok === 0) {
    output.ok = 1;
    delete output.errmsg;
    delete output.code;
    delete output.codeName;
  }

  return output;
}

/**
 * An error thrown when the server reports a writeConcernError
 *
 * @param {Error|string|object} message The error message
 * @param {object} result The result document (provided if ok: 1)
 * @property {string} message The error message
 * @property {object} [result] The result document (provided if ok: 1)
 */
export class MongoWriteConcernError extends MongoError {
  result?: ReturnType<typeof makeWriteConcernResultObject>;
  constructor(
    message: ConstructorParameters<typeof MongoError>,
    result?: ReturnType<typeof makeWriteConcernResultObject>
  ) {
    super(message);
    this.name = 'MongoWriteConcernError';

    if (result != null) {
      this.result = makeWriteConcernResultObject(result);
    }
  }
}

// see: https://github.com/mongodb/specifications/blob/master/source/retryable-writes/retryable-writes.rst#terms
const RETRYABLE_ERROR_CODES = new Set([
  6, // HostUnreachable
  7, // HostNotFound
  89, // NetworkTimeout
  91, // ShutdownInProgress
  189, // PrimarySteppedDown
  9001, // SocketException
  10107, // NotMaster
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13435, // NotMasterNoSlaveOk
  13436 // NotMasterOrSecondary
]);

/**
 * Determines whether an error is something the driver should attempt to retry
 *
 * @param {MongoError|Error} error
 */
export function isRetryableError(error: Error) {
  return (
    RETRYABLE_ERROR_CODES.has((error as any).code) ||
    error instanceof MongoNetworkError ||
    error.message.match(/not master/) ||
    error.message.match(/node is recovering/)
  );
}

const SDAM_UNRECOVERABLE_ERROR_CODES = new Set([
  91, // ShutdownInProgress
  189, // PrimarySteppedDown
  10107, // NotMaster
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13435, // NotMasterNoSlaveOk
  13436 // NotMasterOrSecondary
]);
/**
 * Determines whether an error is a "node is recovering" error or a "not master" error for SDAM retryability.
 * See https://github.com/mongodb/specifications/blob/master/source/server-discovery-and-monitoring/server-discovery-and-monitoring.rst#not-master-and-node-is-recovering
 * @param {MongoError|Error} error
 */
export function isSDAMUnrecoverableError(error: Error) {
  return (
    SDAM_UNRECOVERABLE_ERROR_CODES.has((error as any).code) ||
    (error.message &&
      (error.message.match(/not master/) || error.message.match(/node is recovering/)))
  );
}
