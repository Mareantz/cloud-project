export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export function requireFields(
  body: Record<string, unknown>,
  fields: string[],
): ValidationResult {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null) {
      return { valid: false, message: `Field "${field}" is required.` };
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        valid: false,
        message: `Field "${field}" must be a non-empty string.`,
      };
    }
  }

  return { valid: true };
}

export function validateRating(rating: unknown): ValidationResult {
  if (typeof rating !== 'number' || !Number.isInteger(rating)) {
    return { valid: false, message: 'Field "rating" must be an integer.' };
  }

  if (rating < 1 || rating > 5) {
    return {
      valid: false,
      message: 'Field "rating" must be between 1 and 5.',
    };
  }

  return { valid: true };
}
