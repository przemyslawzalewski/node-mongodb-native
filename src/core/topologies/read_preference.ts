export interface ReadPreferenceOptions {
  maxStalenessSeconds?: number;
}

type ReadPreferenceTag = string;

type ReadPreferenceJSON = {
  mode: string;
  tags?: ReadPreferenceTag[];
  maxStalenessSeconds?: number;
}

/**
 * The **ReadPreference** class is a class that represents a MongoDB ReadPreference and is
 * used to construct connections.
 * @class
 * @param {string} mode A string describing the read preference mode (primary|primaryPreferred|secondary|secondaryPreferred|nearest)
 * @param {array} tags The tags object
 * @param {object} [options] Additional read preference options
 * @param {number} [options.maxStalenessSeconds] Max secondary read staleness in seconds, Minimum value is 90 seconds.
 * @see https://docs.mongodb.com/manual/core/read-preference/
 * @return {ReadPreference}
 */
export class ReadPreference {
  mode: string;
  tags?: ReadPreferenceTag[];
  maxStalenessSeconds?: number;
  minWireVersion?: number;
  constructor(mode: string, tags: ReadPreferenceTag[]|ReadPreferenceTag, options: ReadPreferenceOptions);
  constructor(mode: string, tags: ReadPreferenceTag[]|ReadPreferenceTag);
  constructor(mode: string, options: ReadPreferenceOptions);
  constructor(mode: string);
  constructor(mode: string, tags?: ReadPreferenceTag[]|ReadPreferenceTag|ReadPreferenceOptions, options?: ReadPreferenceOptions) {
    if (!ReadPreference.isValid(mode)) {
      throw new TypeError(`Invalid read preference mode ${mode}`);
    }
  
    // TODO(major): tags MUST be an array of tagsets
    if (tags != null && !Array.isArray(tags)) {
      console.warn(
        'ReadPreference tags must be an array, this will change in the next major version'
      );
  
      if (typeof (tags as ReadPreferenceOptions).maxStalenessSeconds !== 'undefined') {
        // this is likely an options object
        options = (tags as ReadPreferenceOptions);
        this.tags = undefined;
      } else {
        this.tags = [(tags as ReadPreferenceTag)];
      }
    } else {
      this.tags = tags;
    }
  
    this.mode = mode;
  
    options = options || {};
    if (options.maxStalenessSeconds != null) {
      if (options.maxStalenessSeconds <= 0) {
        throw new TypeError('maxStalenessSeconds must be a positive integer');
      }
  
      this.maxStalenessSeconds = options.maxStalenessSeconds;
  
      // NOTE: The minimum required wire version is 5 for this read preference. If the existing
      //       topology has a lower value then a MongoError will be thrown during server selection.
      this.minWireVersion = 5;
    }
  
    if (this.mode === ReadPreference.PRIMARY) {
      if (this.tags && Array.isArray(this.tags) && this.tags.length > 0) {
        throw new TypeError('Primary read preference cannot be combined with tags');
      }
  
      if (this.maxStalenessSeconds) {
        throw new TypeError('Primary read preference cannot be combined with maxStalenessSeconds');
      }
    }
  }

// Support the deprecated `preference` property introduced in the porcelain layer
  get preference() {
    return this.mode;
  }

  /**
   * Construct a ReadPreference given an options object.
   *
   * @param {object} options The options object from which to extract the read preference.
   * @return {ReadPreference}
   */
  static fromOptions(options: any): ReadPreference|null {
    const readPreference = options.readPreference;
    const readPreferenceTags = options.readPreferenceTags;
  
    if (readPreference == null) {
      return null;
    }
  
    if (typeof readPreference === 'string') {
      return new ReadPreference(readPreference, readPreferenceTags);
    } else if (!(readPreference instanceof ReadPreference) && typeof readPreference === 'object') {
      const mode = readPreference.mode || readPreference.preference;
      if (mode && typeof mode === 'string') {
        return new ReadPreference(mode, readPreference.tags, {
          maxStalenessSeconds: readPreference.maxStalenessSeconds
        });
      }
    }
  
    return readPreference;
  }

  /**
   * Validate if a mode is legal
   *
   * @method
   * @param {string} mode The string representing the read preference mode.
   * @return {boolean} True if a mode is valid
   */
  static isValid(mode: string) {
    return VALID_MODES.indexOf(mode) !== -1;
  }

  /**
   * Validate if a mode is legal
   *
   * @method
   * @param {string} mode The string representing the read preference mode.
   * @return {boolean} True if a mode is valid
   */
  isValid(mode: string) {
    return ReadPreference.isValid(typeof mode === 'string' ? mode : this.mode);
  };

  /**
   * Indicates that this readPreference needs the "slaveOk" bit when sent over the wire
   * @method
   * @return {boolean}
   * @see https://docs.mongodb.com/manual/reference/mongodb-wire-protocol/#op-query
   */
  slaveOk() {
    return needSlaveOk.indexOf(this.mode) !== -1;
  };

  /**
   * Are the two read preference equal
   * @method
   * @param {ReadPreference} readPreference The read preference with which to check equality
   * @return {boolean} True if the two ReadPreferences are equivalent
   */
  equals(readPreference: ReadPreference) {
    return readPreference.mode === this.mode;
  };

  /**
   * Return JSON representation
   * @method
   * @return {Object} A JSON representation of the ReadPreference
   */
  toJSON() {
    const readPreference: ReadPreferenceJSON = { mode: this.mode };
    if (Array.isArray(this.tags)) readPreference.tags = this.tags;
    if (this.maxStalenessSeconds) readPreference.maxStalenessSeconds = this.maxStalenessSeconds;
    return readPreference;
  };

  /*
   * Read preference mode constants
   */
  static PRIMARY = 'primary'
  static PRIMARY_PREFERRED = 'primaryPreferred';
  static SECONDARY = 'secondary';
  static SECONDARY_PREFERRED = 'secondaryPreferred';
  static NEAREST = 'nearest';

  /**
   * Primary read preference
   * @member
   * @type {ReadPreference}
   */
  static primary: ReadPreference = new ReadPreference('primary');
  /**
   * Primary Preferred read preference
   * @member
   * @type {ReadPreference}
   */
  static primaryPreferred = new ReadPreference('primaryPreferred');
  /**
   * Secondary read preference
   * @member
   * @type {ReadPreference}
   */
  static secondary: ReadPreference = new ReadPreference('secondary');
  /**
   * Secondary Preferred read preference
   * @member
   * @type {ReadPreference}
   */
  static secondaryPreferred = new ReadPreference('secondaryPreferred');
  /**
   * Nearest read preference
   * @member
   * @type {ReadPreference}
   */
  static nearest: ReadPreference = new ReadPreference('nearest');
}

const VALID_MODES: (string|null)[] = [
  ReadPreference.PRIMARY,
  ReadPreference.PRIMARY_PREFERRED,
  ReadPreference.SECONDARY,
  ReadPreference.SECONDARY_PREFERRED,
  ReadPreference.NEAREST,
  null
];

const needSlaveOk = ['primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'];

