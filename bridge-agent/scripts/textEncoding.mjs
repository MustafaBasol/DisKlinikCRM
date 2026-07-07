/**
 * textEncoding.mjs — pure helper for enforcing a UTF-8 BOM on packaged
 * .ps1 files (used by scripts/package.mjs).
 *
 * Windows PowerShell 5.1 has no reliable way to detect a BOM-less script
 * file's encoding and falls back to the system codepage. On a pilot
 * clinic PC this misread this repo's em-dash characters (U+2014) as
 * mojibake and produced parser errors. A UTF-8 BOM forces both
 * PowerShell 5.1 and 7 to read the file as UTF-8 regardless of the
 * system locale/codepage.
 */

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

/** Returns a buffer guaranteed to start with a UTF-8 BOM, without doubling
 * one that is already present. */
export function ensureUtf8Bom(buffer) {
  return hasUtf8Bom(buffer) ? buffer : Buffer.concat([UTF8_BOM, buffer]);
}
