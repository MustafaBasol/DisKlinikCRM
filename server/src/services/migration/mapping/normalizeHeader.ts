/**
 * normalizeHeader.ts — F3-DATA-MIG-TODAY
 *
 * ###########################################################################
 * #  THE NORMALIZED FORM IS USED FOR **MATCHING ONLY**.                     #
 * #  IT IS **NEVER** THE STORED MAPPING KEY.                                #
 * #                                                                         #
 * #  The stored key is ALWAYS the byte-exact original header string as it   #
 * #  appeared in the vendor export (CanonicalHeader.original).              #
 * #                                                                         #
 * #  WHY: normalization is lossy and its rules will change (new diacritic   #
 * #  pairs, new punctuation classes, a future ICU upgrade). If a saved      #
 * #  mapping template were keyed on the normalized form, a rerun of the     #
 * #  SAME workbook after ANY rule change would silently re-key: previously  #
 * #  saved decisions would stop matching, columns would fall back to        #
 * #  UNKNOWN_HEADER, and the operator would be asked to re-map a run they   #
 * #  already approved — or worse, two distinct source columns that          #
 * #  normalize to the same string would collide onto one saved decision.    #
 * #  Byte-exact keys make reruns idempotent; normalized keys do not.        #
 * ###########################################################################
 */

/**
 * Turkish-locale upper casing.
 *
 * Turkish has a dotted/dotless i pair that the invariant locale gets wrong:
 *   i (U+0069, dotted lowercase)  -> İ (U+0130, dotted capital)
 *   ı (U+0131, dotless lowercase) -> I (U+0049, dotless capital)
 *
 * WHY the explicit pre-substitution rather than trusting the locale argument:
 * `toLocaleUpperCase('tr-TR')` only honours the Turkish casing rules when the
 * running Node build ships full ICU. A small-icu / no-icu build silently
 * degrades to the root locale and maps `i` -> `I`, which would make `HASTA_ID`
 * and a hypothetical `hasta_ıd` normalize differently on different machines.
 * Header matching must be byte-identical on a developer laptop, in CI, and in
 * production, so we do the two ambiguous mappings ourselves FIRST and let the
 * locale call handle everything else.
 */
export function turkishUpper(s: string): string {
  // Handle the dotted/dotless pair explicitly, before any locale call.
  const preMapped = s.replace(/i/g, 'İ').replace(/ı/g, 'I');
  return preMapped.toLocaleUpperCase('tr-TR');
}

/**
 * Diacritic folding applied AFTER Turkish upper casing.
 *
 * Deliberately a fixed, explicit table rather than NFD + combining-mark
 * stripping: NFD would also decompose characters we have made no decision
 * about, and the resulting behaviour would depend on the Unicode version of
 * the runtime. An explicit table is auditable and stable.
 */
const DIACRITIC_FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/Ç/g, 'C'], // Ç
  [/Ğ/g, 'G'], // Ğ
  [/İ/g, 'I'], // İ  (dotted capital I)
  [/I/g, 'I'], // I  (dotless capital I — already 'I', listed for completeness)
  [/Ö/g, 'O'], // Ö
  [/Ş/g, 'S'], // Ş
  [/Ü/g, 'U'], // Ü
];

/**
 * Produce the MATCHING-ONLY normalized form of a raw header.
 *
 * Pipeline (order matters):
 *   1. trim
 *   2. Turkish-locale upper case (see turkishUpper)
 *   3. fold Turkish diacritics to ASCII (Ç->C, Ğ->G, İ/I->I, Ö->O, Ş->S, Ü->U)
 *   4. collapse every run of non-alphanumeric characters to a single '_'
 *   5. strip leading/trailing '_'
 *
 * Examples:
 *   ' Doğum Tarihi '   -> 'DOGUM_TARIHI'
 *   'CEP TELEFONU'     -> 'CEP_TELEFONU'
 *   'T.C. Kimlik No'   -> 'T_C_KIMLIK_NO'
 *   '__adres kodu__'   -> 'ADRES_KODU'
 *
 * Again: the result is a MATCH KEY, not a STORAGE KEY. See the file header.
 */
export function normalizeHeader(raw: string): string {
  let out = turkishUpper(raw.trim());
  for (const [pattern, replacement] of DIACRITIC_FOLD) {
    out = out.replace(pattern, replacement);
  }
  // Anything that is not an ASCII letter or digit becomes a separator. This
  // intentionally also folds any residual non-Latin character, so the output
  // alphabet is closed: [A-Z0-9_].
  out = out.replace(/[^A-Z0-9]+/g, '_');
  out = out.replace(/^_+/, '').replace(/_+$/, '');
  return out;
}
