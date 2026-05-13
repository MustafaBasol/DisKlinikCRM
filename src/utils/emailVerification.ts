const truthyValues = new Set(['true', '1', 'yes', 'on']);

export const isEmailVerificationRequired = () => {
  try {
    const raw = String((import.meta as any)?.env?.VITE_EMAIL_VERIFICATION_REQUIRED ?? '').trim().toLowerCase();
    return raw === '' || truthyValues.has(raw);
  } catch { return true; }
};
