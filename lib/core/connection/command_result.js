"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Creates a new CommandResult instance
 * @class
 * @param {object} result CommandResult object
 * @param {Connection} connection A connection instance associated with this result
 * @return {CommandResult} A cursor instance
 */
class CommandResult {
    constructor(result, connection, message) {
        this.result = result;
        this.connection = connection;
        this.message = message;
    }
    /**
     * Convert CommandResult to JSON
     * @method
     * @return {object}
     */
    toJSON() {
        let result = Object.assign({}, this, this.result);
        delete result.message;
        return result;
    }
    /**
     * Convert CommandResult to String representation
     * @method
     * @return {string}
     */
    toString() {
        return JSON.stringify(this.toJSON());
    }
}
exports.CommandResult = CommandResult;
