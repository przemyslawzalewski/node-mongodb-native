type LoggerLevel = 'warn'|'error'|'info'|'debug';
type LoggerObject = {
  type: LoggerLevel;
  message: string;
  className: string;
  pid: number;
  date: number;
  meta?: object;
};
type LoggerFunction = (message: string, object: LoggerObject) => void;

export interface LoggerOptions {
  logger?: LoggerFunction;
  loggerLevel?: LoggerLevel;
}

/**
 * Creates a new Logger instance
 * @class
 * @param {string} className The Class name associated with the logging instance
 * @param {object} [options=null] Optional settings.
 * @param {Function} [options.logger=null] Custom logger function;
 * @param {string} [options.loggerLevel=error] Override default global log level.
 * @return {Logger} a Logger instance.
 */
export class Logger {
  constructor(
    className: string,
    options?:  { logger?: LoggerFunction, loggerLevel?: LoggerLevel }
  );

  /**
   * Log a message at the debug level
   * @method
   * @param {string} message The message to log
   * @param {object} object additional meta data to log
   * @return {null}
   */
  debug(message: string, object?: object): void


  /**
   * Log a message at the warn level
   * @method
   * @param {string} message The message to log
   * @param {object} object additional meta data to log
   * @return {null}
   */
  warn(message: string, object?: object): void;

  /**
   * Log a message at the info level
   * @method
   * @param {string} message The message to log
   * @param {object} object additional meta data to log
   * @return {null}
   */
  info(message: string, object?: object): void;

  /**
   * Log a message at the error level
   * @method
   * @param {string} message The message to log
   * @param {object} object additional meta data to log
   * @return {null}
   */
  error(message: string, object?: object): void;

  /**
   * Is the logger set at info level
   * @method
   * @return {boolean}
   */
  isInfo(): boolean;

  /**
   * Is the logger set at error level
   * @method
   * @return {boolean}
   */
  isError(): boolean;
  /**
   * Is the logger set at error level
   * @method
   * @return {boolean}
   */
  isWarn(): boolean;
  /**
   * Is the logger set at debug level
   * @method
   * @return {boolean}
   */
  isDebug(): boolean;

  /**
   * Resets the logger to default settings, error and no filtered classes
   * @method
   * @return {null}
   */
  static reset(): void

  /**
   * Get the current logger function
   * @method
   * @return {function}
   */
  static currentLogger(): void;

  /**
   * Set the current logger function
   * @method
   * @param {function} logger Logger function.
   * @return {null}
   */
  static setCurrentLogger(logger: LoggerFunction): void;

  /**
   * Set what classes to log.
   * @method
   * @param {string} type The type of filter (currently only class)
   * @param {string[]} values The filters to apply
   * @return {null}
   */
  static filter(type: string, values: string[]): void;


  /**
   * Set the current log level
   * @method
   * @param {string} level Set current log level (debug, info, error)
   * @return {null}
   */
  static setLevel(_level: string): void;
}
