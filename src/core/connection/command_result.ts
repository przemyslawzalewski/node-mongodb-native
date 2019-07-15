/**
 * Creates a new CommandResult instance
 * @class
 * @param {object} result CommandResult object
 * @param {Connection} connection A connection instance associated with this result
 * @return {CommandResult} A cursor instance
 */
export class CommandResult {
  constructor(
    public result: any,
    public connection: any,
    public message: any
  ) {}

  /**
   * Convert CommandResult to JSON
   * @method
   * @return {object}
   */
  toJSON(): object {
    let result = Object.assign({}, this, this.result);
    delete result.message;
    return result;
  }

  /**
   * Convert CommandResult to String representation
   * @method
   * @return {string}
   */
  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}