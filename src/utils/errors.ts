// Recursively extracts the first leaf message from a Zod .format()-style tree (nodes with `_errors: string[]`).
function extractZodFormatMessage(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const errors = (node as any)._errors;
  if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === 'string') {
    return errors[0];
  }
  for (const key of Object.keys(node as object)) {
    if (key === '_errors') continue;
    const message = extractZodFormatMessage((node as any)[key]);
    if (message) return message;
  }
  return null;
}

/**
 * Safely converts an unknown error (Axios error, Error, Zod validation payload, etc.)
 * into a displayable string. Never returns an object — guards against React error #31
 * (objects are not valid as a React child) when rendering caught errors in JSX.
 */
export function getErrorMessage(err: unknown, fallback = 'Bir hata oluştu.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;

  const anyErr = err as any;
  const data = anyErr?.response?.data;

  if (data) {
    if (typeof data === 'string') return data;

    if (Array.isArray(data.issues) && data.issues.length > 0) {
      const first = data.issues[0];
      if (typeof first?.message === 'string') return first.message;
    }

    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;

    if (data.error && typeof data.error === 'object') {
      const zodMessage = extractZodFormatMessage(data.error);
      if (zodMessage) return zodMessage;
    }

    if (Array.isArray(data.details) && data.details.length > 0) {
      const first = data.details[0];
      if (typeof first === 'string') return first;
      if (typeof first?.message === 'string') return first.message;
    }
  }

  if (typeof anyErr?.message === 'string') return anyErr.message;

  return fallback;
}
