/**
 * The message of something caught (`catch (err)` is unknown): an Error's or an object's non-empty `message`,
 * else the fallback. Things thrown without a message (strings, null) get the fallback as well.
 */
export function errorMessage(err: unknown, fallback = ''): string {
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' && err.message) {
    return err.message;
  }
  return fallback;
}
