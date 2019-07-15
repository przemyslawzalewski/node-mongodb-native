const require_optional = require('require_optional');
import * as BSON from 'bson';
import * as snappy from 'snappy';

export function debugOptions<T extends Record<string, any>, K extends keyof T>(debugFields: K[], options: T) {
  const finaloptions: Partial<Pick<T, K>> = {};
  debugFields.forEach(function(n) {
    finaloptions[n] = options[n];
  });

  return finaloptions;
}

export function retrieveBSON(): typeof BSON {
  var BSON = require('bson');
  BSON.native = false;

  try {
    var optionalBSON = require_optional('bson-ext');
    if (optionalBSON) {
      optionalBSON.native = true;
      return optionalBSON;
    }
  } catch (err) {} // eslint-disable-line

  return BSON;
}

// Throw an error if an attempt to use Snappy is made when Snappy is not installed
function noSnappyWarning() {
  throw new Error(
    'Attempted to use Snappy compression, but Snappy is not installed. Install or disable Snappy compression and try again.'
  );
}

// Facilitate loading Snappy optionally
export function retrieveSnappy(): typeof snappy {
  var snappy = null;
  try {
    snappy = require_optional('snappy');
  } catch (error) {} // eslint-disable-line
  if (!snappy) {
    snappy = {
      compress: noSnappyWarning,
      uncompress: noSnappyWarning,
      compressSync: noSnappyWarning,
      uncompressSync: noSnappyWarning
    };
  }
  return snappy;
}
