/**
 * patientBloodGroup.vitest.test.ts — F3-DATA-MIG-TODAY-001-R8
 *
 * The blood-group vocabulary is declared in three places that CANNOT be a
 * single module: the Prisma schema, the server's zod schema, and this client
 * constant (the browser bundle does not import server code). Two of those are
 * pinned against each other by server/src/tests/patientBloodGroup.test.ts.
 * This file pins the third, plus the four locale files.
 *
 * The failure it prevents is specific and silent: a select offering an option
 * the API rejects with a 400, or an option whose label falls back to the raw
 * `A_POSITIVE` token in one language because a translator's file was missed.
 */

import { describe, it, expect } from 'vitest';

import { PATIENT_BLOOD_GROUP_VALUES, bloodGroupLabelKey } from '../patientBloodGroup';

import trPatients from '../../locales/tr/patients.json';
import enPatients from '../../locales/en/patients.json';
import frPatients from '../../locales/fr/patients.json';
import dePatients from '../../locales/de/patients.json';
import trPlatform from '../../locales/tr/platform.json';
import enPlatform from '../../locales/en/platform.json';
import frPlatform from '../../locales/fr/platform.json';
import dePlatform from '../../locales/de/platform.json';

type Dict = Record<string, unknown>;

const PATIENTS: Array<[string, Dict]> = [
  ['tr', trPatients as Dict],
  ['en', enPatients as Dict],
  ['fr', frPatients as Dict],
  ['de', dePatients as Dict],
];

const PLATFORM: Array<[string, Dict]> = [
  ['tr', trPlatform as Dict],
  ['en', enPlatform as Dict],
  ['fr', frPlatform as Dict],
  ['de', dePlatform as Dict],
];

describe('patient blood group — canonical vocabulary', () => {
  it('is exactly the eight ABO/Rh combinations, with no placeholder member', () => {
    expect([...PATIENT_BLOOD_GROUP_VALUES]).toEqual([
      'A_POSITIVE',
      'A_NEGATIVE',
      'B_POSITIVE',
      'B_NEGATIVE',
      'AB_POSITIVE',
      'AB_NEGATIVE',
      'O_POSITIVE',
      'O_NEGATIVE',
    ]);
    // NULL means "not recorded". A member meaning "recorded as unknown" would
    // be a different clinical claim, and the form's empty option already
    // expresses absence.
    for (const value of PATIENT_BLOOD_GROUP_VALUES) {
      expect(value).not.toMatch(/UNKNOWN|UNSPECIFIED|NONE|OTHER/);
    }
  });

  it('stores the ABO group as the LETTER O, never the digit 0', () => {
    // The digit is a Turkish/German PRESENTATION convention handled by the
    // locale label. If it ever leaked into the stored token, the API would
    // reject it and the two spellings would drift into separate values.
    for (const value of PATIENT_BLOOD_GROUP_VALUES) {
      expect(value).not.toMatch(/^0/);
    }
    expect(PATIENT_BLOOD_GROUP_VALUES).toContain('O_POSITIVE');
  });

  it('builds label keys under the patients namespace', () => {
    expect(bloodGroupLabelKey('A_POSITIVE')).toBe('patients:bloodGroup.A_POSITIVE');
  });
});

describe('patient blood group — locale completeness', () => {
  it.each(PATIENTS)('%s/patients.json labels every canonical value and nothing else', (lang, dict) => {
    const labels = dict.bloodGroup as Record<string, string> | undefined;
    expect(labels, `${lang} is missing the bloodGroup label block`).toBeDefined();

    for (const value of PATIENT_BLOOD_GROUP_VALUES) {
      const label = labels![value];
      expect(label, `${lang} has no label for ${value}`).toBeTruthy();
      // A label identical to the token means the translator's file was missed
      // and the UI would show A_POSITIVE to a clinician.
      expect(label).not.toBe(value);
    }
    // No stray key: an extra option here is an option the API would reject.
    expect(Object.keys(labels!).sort()).toEqual([...PATIENT_BLOOD_GROUP_VALUES].sort());
  });

  it.each(PATIENTS)('%s/patients.json has the field label and the "not recorded" option', (lang, dict) => {
    const form = dict.form as Record<string, string>;
    expect(form.bloodGroup, `${lang} form.bloodGroup`).toBeTruthy();
    expect(form.bloodGroupUnspecified, `${lang} form.bloodGroupUnspecified`).toBeTruthy();
  });

  it('presents the O group per local clinical convention without changing the stored value', () => {
    // Turkish and German clinical usage writes it with a zero; English and
    // French use the letter. All four store O_POSITIVE.
    expect((trPatients as Dict).bloodGroup as Record<string, string>).toMatchObject({ O_POSITIVE: '0 Rh+' });
    expect((dePatients as Dict).bloodGroup as Record<string, string>).toMatchObject({ O_POSITIVE: '0 Rh+' });
    expect((enPatients as Dict).bloodGroup as Record<string, string>).toMatchObject({ O_POSITIVE: 'O Rh+' });
    expect((frPatients as Dict).bloodGroup as Record<string, string>).toMatchObject({ O_POSITIVE: 'O Rh+' });
  });

  it.each(PLATFORM)('%s/platform.json names the destination and the transform for the mapping UI', (lang, dict) => {
    const mapping = (dict.migration as Dict).mapping as Dict;
    const destinations = mapping.destinationLabels as Record<string, string>;
    const transforms = mapping.transforms as Record<string, string>;
    expect(destinations['patient.bloodGroup'], `${lang} destinationLabels`).toBeTruthy();
    expect(transforms.blood_group_tr, `${lang} transforms`).toBeTruthy();
  });
});
