import { ApplicationError } from '../errors/application-error.js';

export function encodeCursor(productId) {
  return Buffer.from(
    JSON.stringify({ version: 1, after: productId }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('Cursor contains invalid characters.');
    }

    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const keys = Object.keys(parsed).sort();
    if (
      parsed.version !== 1 ||
      typeof parsed.after !== 'string' ||
      keys.length !== 2 ||
      keys[0] !== 'after' ||
      keys[1] !== 'version'
    ) {
      throw new Error('Cursor has an unsupported payload.');
    }

    return parsed.after;
  } catch {
    throw new ApplicationError(
      400,
      'Invalid cursor',
      'The cursor is malformed or is not supported by this server.',
      'invalid-cursor',
    );
  }
}
