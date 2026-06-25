/**
 * Koşturma: cd server && npx tsx src/tests/patientName.test.ts
 */

import assert from 'node:assert/strict';
import { sanitizePatientNameInput, splitNameForPatient, titleCaseName } from '../utils/patientName.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message ?? err}`);
    failed++;
  }
}

console.log('\n=== WhatsApp Hasta Adı Temizleme ===');

test('"Adım Enes Karataş" ifadesindeki tanıtım kelimesi kayda girmez', () => {
  assert.equal(sanitizePatientNameInput('Adım Enes Karataş'), 'Enes Karataş');
  assert.deepEqual(splitNameForPatient('Adım Enes Karataş'), {
    firstName: 'Enes',
    lastName: 'Karataş',
  });
});

test('yaygın isim tanıtım varyantları temizlenir', () => {
  assert.equal(titleCaseName('benim adım ayşe yılmaz'), 'Ayşe Yılmaz');
  assert.equal(titleCaseName('ismim mehmet demir'), 'Mehmet Demir');
  assert.equal(titleCaseName('Ad soyad: zeynep kaya'), 'Zeynep Kaya');
});

test('düz ad soyad davranışı değişmez', () => {
  assert.deepEqual(splitNameForPatient('enes karataş'), {
    firstName: 'Enes',
    lastName: 'Karataş',
  });
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
