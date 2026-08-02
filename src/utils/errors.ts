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

async function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * Like getErrorMessage, but also handles Axios errors from a `responseType: 'blob'` request.
 * When such a request fails with a JSON error body, Axios does not parse it — err.response.data
 * arrives as an opaque Blob (not a parsed object), so getErrorMessage's shape checks never match
 * and it silently falls back to Axios's generic "Request failed with status code NNN" message,
 * hiding the real server error (e.g. "Proposal generation failed").
 *
 * This reads the Blob's text, parses it as JSON, and re-runs it through getErrorMessage as if
 * Axios had parsed the body normally — so `{ error: "..." }`, `{ message: "..." }` and
 * `{ error: { ... } }` (Zod format tree) all resolve the same way they do for a non-blob response.
 * Any failure along the way (data isn't a Blob, unreadable, not JSON) falls back to the plain
 * synchronous getErrorMessage result — this never throws and never resolves to a non-string.
 */
export async function getApiErrorMessage(err: unknown, fallback = 'Bir hata oluştu.'): Promise<string> {
  const data = (err as any)?.response?.data;

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const text = await readBlobAsText(data);
      const parsed = JSON.parse(text);
      return getErrorMessage({ response: { data: parsed } }, fallback);
    } catch {
      // Not JSON, unreadable, or some other Blob-parsing failure — fall through safely below.
    }
  }

  return getErrorMessage(err, fallback);
}
