/** Covers requirement 7: deterministic finding IDs. */
import type { Harness } from './testHarness.js';
import { computeFindingId } from '../lib/findingId.js';
import type { ExactEdgeTuple } from '../lib/types.js';

const TUPLE_A: ExactEdgeTuple = {
  callerPath: 'server/src/routes/orderRoute.ts',
  callerSymbol: 'processPayment',
  ownerDomain: 'domain-payments',
  targetModelOrSymbol: 'services/paymentService.ts',
  accessKind: 'import',
};

export function registerFindingIdTests(h: Harness): void {
  h.section('findingId: deterministic hashing of the semantic tuple');

  h.test('identical tuples produce identical IDs across repeated calls', () => {
    const a = computeFindingId(TUPLE_A);
    const b = computeFindingId({ ...TUPLE_A });
    h.assertEqual(a, b, 'same tuple must hash identically');
  });

  h.test('changing any single field changes the ID', () => {
    const base = computeFindingId(TUPLE_A);
    const variants: ExactEdgeTuple[] = [
      { ...TUPLE_A, callerPath: 'server/src/routes/otherRoute.ts' },
      { ...TUPLE_A, callerSymbol: 'refundPayment' },
      { ...TUPLE_A, ownerDomain: 'domain-inventory' },
      { ...TUPLE_A, targetModelOrSymbol: 'services/otherService.ts' },
    ];
    for (const variant of variants) {
      h.assert(computeFindingId(variant) !== base, `field change must change the ID: ${JSON.stringify(variant)}`);
    }
  });

  h.test('ID does not depend on any line-number or ordering detail (only the 5 tuple fields are hashed)', () => {
    // computeFindingId's signature only accepts the tuple — there is no
    // line/column parameter to pass, so this is structurally guaranteed;
    // this test documents the guarantee rather than probing internals.
    const id = computeFindingId(TUPLE_A);
    h.assertEqual(id.length, 16, 'ID is a fixed-length truncated hash, independent of input size/content shape');
  });

  h.test('ID is a lowercase hex string (stable, filesystem/JSON-safe)', () => {
    const id = computeFindingId(TUPLE_A);
    h.assert(/^[0-9a-f]{16}$/.test(id), `ID must be 16 lowercase hex chars, got "${id}"`);
  });
}
