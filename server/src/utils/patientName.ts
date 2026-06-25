const LEADING_NAME_INTRO_PATTERNS = [
  /^(?:benim\s+)?ad[ıi]m(?:\s+soyad[ıi]m)?\s*(?:[:=-]\s*)?/iu,
  /^(?:benim\s+)?ismim\s*(?:[:=-]\s*)?/iu,
  /^(?:benim\s+)?isim(?:\s+soyisim)?\s*(?:[:=-]\s*)?/iu,
  /^ad(?:[ıi]n[ıi]z)?\s+soyad(?:[ıi]n[ıi]z)?\s*(?:[:=-]\s*)?/iu,
];

export const sanitizePatientNameInput = (value: string) => {
  let normalized = value.replace(/\s+/g, ' ').trim();
  for (const pattern of LEADING_NAME_INTRO_PATTERNS) {
    normalized = normalized.replace(pattern, '').trim();
  }
  return normalized;
};

export const titleCaseName = (value: string) => sanitizePatientNameInput(value).split(/\s+/)
  .filter(Boolean)
  .map(part => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR'))
  .join(' ');

export const splitNameForPatient = (value: string) => {
  const normalized = titleCaseName(value);
  const [firstName, ...lastNameParts] = normalized.split(/\s+/);
  return { firstName: firstName || '', lastName: lastNameParts.join(' ') };
};
