export class AppError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error?.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'The request body is not valid JSON.' };
  }
  if (error?.type === 'entity.too.large') {
    return { status: 413, code: 'BODY_TOO_LARGE', message: 'The request exceeds the 1 MB limit.' };
  }
  const number = Math.abs(Number(error?.errorNum || 0));
  if (number >= 20000 && number <= 20999) {
    const match = String(error.message).match(/ORA-\d+:\s*([^\r\n]+)/);
    const status = number === 20101 ? 404 : [20104, 20107, 20108, 20109, 20111, 20113].includes(number) ? 409 : 422;
    return { status, code: `ORA-${number}`, message: match?.[1] || 'The database rejected this operation.' };
  }
  const known = {
    1: [409, 'DUPLICATE_RECORD', 'A record with these unique details already exists.'],
    1400: [422, 'REQUIRED_FIELD', 'A required database field is missing.'],
    2290: [422, 'INVALID_VALUE', 'A value violates a database constraint.'],
    2291: [422, 'RELATED_RECORD_MISSING', 'A selected related record does not exist.'],
    2292: [409, 'RECORD_IN_USE', 'This record is referenced by existing records.'],
    12899: [422, 'VALUE_TOO_LONG', 'A value is too long for its database field.'],
    60: [409, 'CONCURRENT_CHANGE', 'Another request conflicted with this change. Please retry.'],
    1013: [503, 'DATABASE_TIMEOUT', 'The database operation timed out. Please retry.']
  };
  if (known[number]) {
    const [status, code, message] = known[number];
    return { status, code, message };
  }
  if (String(error?.code || '').startsWith('NJS-') || [1017, 12514, 12541, 3113, 3114].includes(number)) {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'The Oracle connection is unavailable. Check the backend terminal.' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'The request could not be completed.' };
}
