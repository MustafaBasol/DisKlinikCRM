/**
 * tenantContext.test.ts — F3-2 execution-context contract.
 *
 * The context is the foundation the whole guard stands on, and its two most
 * dangerous failure modes are invisible in ordinary use:
 *
 *   1. LEAKAGE. Two requests interleaving and one seeing the other's tenant.
 *      A module-level variable would do this on the first concurrent load, and
 *      the symptom would be one clinic occasionally seeing another's rows —
 *      exactly the bug this programme exists to prevent, produced by the
 *      mechanism meant to prevent it. Several tests below hammer that directly.
 *   2. SILENT ESCALATION. `runAsSystem` becoming the way tired code gets past
 *      the guard. The tests here assert that an ordinary tenant request CANNOT
 *      reach system execution for any reason outside the three-entry allowlist.
 *
 * Also covers the real Express middleware, driven through a stack of handlers,
 * because "AsyncLocalStorage propagates through next()" is a claim about
 * Express's calling convention and deserves to be executed rather than
 * believed.
 *
 * DATABASE-FREE: no Prisma client, no DATABASE_URL, no network.
 *
 * Run with: tsx src/tests/tenantContext.test.ts
 */

import assert from 'node:assert/strict';

import {
  SYSTEM_CONTEXT_REASONS,
  SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST,
  TenantContextError,
  describeExecutionContext,
  getExecutionContext,
  getSystemContext,
  getTenantContext,
  isSystemContext,
  requireTenantContext,
  runAsSystem,
  runAsTenant,
  type SystemContextReason,
  type TenantClinicScope,
} from '../tenancy/tenantContext.js';
import { tenantContextMiddleware } from '../middleware/tenantContext.js';
import type { AuthRequest } from '../middleware/auth.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';
const CLINIC_A1 = 'clinic-a1';
const CLINIC_A2 = 'clinic-a2';
const CLINIC_B1 = 'clinic-b1';

const tenantA = {
  organizationId: ORG_A,
  clinicScope: { kind: 'EXPLICIT' as const, clinicIds: [CLINIC_A1, CLINIC_A2] },
  actor: { kind: 'USER' as const, id: 'user-a' },
};
const tenantB = {
  organizationId: ORG_B,
  clinicScope: { kind: 'EXPLICIT' as const, clinicIds: [CLINIC_B1] },
  actor: { kind: 'USER' as const, id: 'user-b' },
};

function expectContextError(fn: () => unknown, code: string): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('expected a synchronous throw; got a promise');
    }
    throw new Error(`expected TenantContextError(${code}), but the call returned normally`);
  } catch (err) {
    assert.ok(err instanceof TenantContextError, `expected TenantContextError, got ${String(err)}`);
    assert.equal(err.code, code);
  }
}

async function expectAsyncContextError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error(`expected TenantContextError(${code}), but the call resolved`);
  } catch (err) {
    assert.ok(err instanceof TenantContextError, `expected TenantContextError, got ${String(err)}`);
    assert.equal(err.code, code);
  }
}

/** Narrows a clinic scope to its EXPLICIT id list, failing loudly if it is organization-wide. */
function explicitClinicIds(scope: TenantClinicScope): readonly string[] {
  assert.equal(scope.kind, 'EXPLICIT', 'expected an EXPLICIT clinic scope');
  return (scope as Extract<TenantClinicScope, { kind: 'EXPLICIT' }>).clinicIds;
}

/** Yields to the macrotask queue, forcing real interleaving rather than microtask ordering. */
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  // ── A. Basic establishment and shape ───────────────────────────────────────
  section('A. Establishing a context');

  await test('no context is active by default', () => {
    assert.equal(getExecutionContext(), undefined);
    assert.equal(getTenantContext(), undefined);
    assert.equal(isSystemContext(), false);
    assert.equal(describeExecutionContext(), 'no-context');
  });

  await test('runAsTenant makes the tenant visible inside, and only inside', async () => {
    await runAsTenant(tenantA, async () => {
      const ctx = requireTenantContext();
      assert.equal(ctx.organizationId, ORG_A);
      assert.deepEqual([...explicitClinicIds(ctx.clinicScope)], [CLINIC_A1, CLINIC_A2]);
      assert.equal(ctx.mode, 'TENANT');
    });
    assert.equal(getExecutionContext(), undefined, 'context must not survive the call');
  });

  await test('the context survives awaits, timers and nested async calls', async () => {
    await runAsTenant(tenantA, async () => {
      await tick(5);
      const deep = async () => {
        await tick(1);
        return (async () => requireTenantContext().organizationId)();
      };
      assert.equal(await deep(), ORG_A);
    });
  });

  await test('the context object is frozen — downstream code cannot widen its own scope', async () => {
    await runAsTenant(tenantA, async () => {
      const ctx = requireTenantContext();
      assert.throws(() => {
        (ctx as unknown as { organizationId: string }).organizationId = ORG_B;
      });
      assert.equal(requireTenantContext().organizationId, ORG_A);
    });
  });

  await test('an empty EXPLICIT clinic list is legal and means "no clinic access"', async () => {
    await runAsTenant(
      { ...tenantA, clinicScope: { kind: 'EXPLICIT', clinicIds: [] } },
      async () => {
        const scope = requireTenantContext().clinicScope;
        assert.equal(scope.kind, 'EXPLICIT');
        assert.deepEqual([...explicitClinicIds(scope)], []);
      },
    );
  });

  await test('an empty organizationId is rejected', () => {
    expectContextError(() => runAsTenant({ ...tenantA, organizationId: '' }, async () => undefined), 'TENANT_CONTEXT_INVALID');
  });

  await test('an empty clinic id inside the list is rejected (empty LIST is fine, empty STRING is a defect)', () => {
    expectContextError(
      () => runAsTenant({ ...tenantA, clinicScope: { kind: 'EXPLICIT', clinicIds: ['', CLINIC_A1] } }, async () => undefined),
      'TENANT_CONTEXT_INVALID',
    );
  });

  await test('a LAZY thenable returned from the callback is still subscribed to inside the context', async () => {
    // THE REGRESSION THIS PINS. A PrismaPromise does nothing until something
    // calls `.then` on it. With a naive `storage.run(ctx, fn)`, the promise is
    // BUILT inside the context, returned, the context exits, and only then does
    // the caller's `await` subscribe — so the query executes with no context at
    // all. The F3-2 benchmark hit exactly this and died with
    // MISSING_TENANT_CONTEXT on its first guarded query.
    //
    // A plain eager Promise cannot detect the difference, which is why this
    // fixture records the store at SUBSCRIPTION time rather than at creation.
    let storeAtSubscription: string | undefined = 'unset';
    const lazyThenable = {
      then(resolve: (value: string) => void) {
        storeAtSubscription = getTenantContext()?.organizationId;
        Promise.resolve().then(() => resolve('done'));
      },
    };

    // The dangerous shape: a NON-async callback returning the lazy thenable.
    const result = await runAsTenant(tenantA, () => lazyThenable as unknown as Promise<string>);

    assert.equal(result, 'done');
    assert.equal(
      storeAtSubscription,
      ORG_A,
      'the lazy thenable was subscribed to outside the context — every Prisma call written as ' +
        'runAsTenant(ctx, () => prisma.x.findMany()) would run unscoped',
    );
  });

  // ── B. Fail-closed accessors ───────────────────────────────────────────────
  section('B. Missing context fails closed');

  await test('requireTenantContext throws outside any context', () => {
    expectContextError(() => requireTenantContext(), 'TENANT_CONTEXT_MISSING');
  });

  await test('requireTenantContext throws under SYSTEM execution — system work may not borrow tenant semantics', async () => {
    await runAsSystem({ reason: 'background-job' }, async () => {
      expectContextError(() => requireTenantContext(), 'TENANT_CONTEXT_MISSING');
    });
  });

  await test('an error thrown inside a context does not leak the context out of it', async () => {
    await assert.rejects(
      runAsTenant(tenantA, async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(getExecutionContext(), undefined);
  });

  // ── C. Nesting rules ───────────────────────────────────────────────────────
  section('C. Nesting');

  await test('re-entering the SAME organization is allowed (narrowing the clinic set)', async () => {
    await runAsTenant(tenantA, async () => {
      await runAsTenant({ ...tenantA, clinicScope: { kind: 'EXPLICIT', clinicIds: [CLINIC_A1] } }, async () => {
        assert.deepEqual([...explicitClinicIds(requireTenantContext().clinicScope)], [CLINIC_A1]);
      });
      assert.deepEqual([...explicitClinicIds(requireTenantContext().clinicScope)], [CLINIC_A1, CLINIC_A2]);
    });
  });

  await test('entering a DIFFERENT organization from inside a tenant context throws', async () => {
    await runAsTenant(tenantA, async () => {
      expectContextError(() => runAsTenant(tenantB, async () => undefined), 'TENANT_CONTEXT_CROSS_ORGANIZATION_REENTRY');
    });
  });

  await test('a system job may enter any tenant — that is how per-clinic work is scoped', async () => {
    await runAsSystem({ reason: 'background-job', detail: 'reminders' }, async () => {
      await runAsTenant(tenantA, async () => {
        assert.equal(requireTenantContext().organizationId, ORG_A);
      });
      await runAsTenant(tenantB, async () => {
        assert.equal(requireTenantContext().organizationId, ORG_B);
      });
      assert.equal(isSystemContext(), true, 'system context is restored after each tenant slice');
    });
  });

  // ── D. System execution is narrow ──────────────────────────────────────────
  section('D. System execution');

  await test('every declared reason is accepted outside a tenant context', async () => {
    for (const reason of SYSTEM_CONTEXT_REASONS) {
      await runAsSystem({ reason }, async () => {
        assert.equal(getSystemContext()?.reason, reason);
      });
    }
  });

  await test('an undeclared reason is rejected at runtime, not only by the type system', async () => {
    await expectAsyncContextError(
      () => runAsSystem({ reason: 'because-i-said-so' as SystemContextReason }, async () => undefined),
      'SYSTEM_CONTEXT_REASON_UNKNOWN',
    );
  });

  await test('a tenant request CANNOT escalate to system execution for a non-allowlisted reason', async () => {
    await runAsTenant(tenantA, async () => {
      for (const reason of SYSTEM_CONTEXT_REASONS) {
        if (SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST.has(reason)) continue;
        await expectAsyncContextError(() => runAsSystem({ reason }, async () => undefined), 'SYSTEM_ESCALATION_FORBIDDEN');
      }
    });
  });

  await test('the three allowlisted reasons DO escalate from a tenant request (and are exactly three)', async () => {
    assert.equal(SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST.size, 3);
    await runAsTenant(tenantA, async () => {
      for (const reason of SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST) {
        await runAsSystem({ reason }, async () => {
          assert.equal(isSystemContext(), true);
        });
      }
      assert.equal(requireTenantContext().organizationId, ORG_A, 'the tenant context is restored afterwards');
    });
  });

  await test('the allowlist is a strict subset of the declared reasons', () => {
    for (const reason of SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST) {
      assert.ok(SYSTEM_CONTEXT_REASONS.includes(reason), `${reason} is allowlisted but not declared`);
    }
    assert.ok(
      SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST.size < SYSTEM_CONTEXT_REASONS.length,
      'if every reason could escalate from a tenant request, the allowlist would be decoration',
    );
  });

  await test('describeExecutionContext leaks no identifiers into logs', async () => {
    await runAsTenant(tenantA, async () => {
      const described = describeExecutionContext();
      assert.ok(!described.includes(ORG_A));
      assert.ok(!described.includes(CLINIC_A1));
      assert.ok(!described.includes('user-a'));
      assert.equal(described, 'tenant:2-clinic');
    });
    await runAsSystem({ reason: 'background-job', detail: 'reminders' }, async () => {
      assert.equal(describeExecutionContext(), 'system:background-job');
    });
  });

  // ── E. Concurrency isolation — the headline property ───────────────────────
  section('E. Concurrent contexts do not leak into each other');

  await test('two concurrent tenants interleaving on real timers never see each other', async () => {
    const observed: Array<{ expected: string; actual: string }> = [];

    const run = async (tenant: typeof tenantA, delays: number[]) => {
      await runAsTenant(tenant, async () => {
        for (const delay of delays) {
          await tick(delay);
          observed.push({ expected: tenant.organizationId, actual: requireTenantContext().organizationId });
        }
      });
    };

    // Deliberately mismatched delays so the two chains resume interleaved.
    await Promise.all([run(tenantA, [3, 1, 4, 1, 5]), run(tenantB, [2, 7, 1, 8, 2])]);

    assert.equal(observed.length, 10);
    for (const { expected, actual } of observed) assert.equal(actual, expected);
  });

  await test('50 concurrent tenants each observe exactly their own organization', async () => {
    const count = 50;
    const results = await Promise.all(
      Array.from({ length: count }, (_unused, i) =>
        runAsTenant(
          {
            organizationId: `org-${i}`,
            clinicScope: { kind: 'EXPLICIT', clinicIds: [`clinic-${i}`] },
            actor: { kind: 'USER', id: `user-${i}` },
          },
          async () => {
            await tick(i % 7);
            const org = requireTenantContext().organizationId;
            await tick((count - i) % 5);
            const orgAgain = requireTenantContext().organizationId;
            return { i, org, orgAgain };
          },
        ),
      ),
    );

    for (const { i, org, orgAgain } of results) {
      assert.equal(org, `org-${i}`);
      assert.equal(orgAgain, `org-${i}`);
    }
  });

  await test('a system job interleaved with tenant requests does not become one of them', async () => {
    let systemSawTenant: unknown = 'unset';
    await Promise.all([
      runAsTenant(tenantA, async () => {
        await tick(2);
        assert.equal(requireTenantContext().organizationId, ORG_A);
      }),
      runAsSystem({ reason: 'background-job' }, async () => {
        await tick(1);
        systemSawTenant = getTenantContext();
        await tick(2);
        assert.equal(isSystemContext(), true);
      }),
      runAsTenant(tenantB, async () => {
        await tick(3);
        assert.equal(requireTenantContext().organizationId, ORG_B);
      }),
    ]);
    assert.equal(systemSawTenant, undefined);
  });

  // ── F. The Express middleware ──────────────────────────────────────────────
  section('F. Request-boundary integration (real middleware)');

  type Handler = (req: AuthRequest, res: unknown, next: (err?: unknown) => void) => void;

  function fakeRequest(user: Partial<NonNullable<AuthRequest['user']>> & { organizationId: string }): AuthRequest {
    return {
      id: 'req-1',
      user: {
        id: 'user-x',
        clinicId: CLINIC_A1,
        role: 'admin',
        normalizedRole: 'ORG_ADMIN',
        allowedClinicIds: [CLINIC_A1],
        canAccessAllClinics: false,
        ...user,
      },
    } as unknown as AuthRequest;
  }

  /** Runs the middleware then a terminal handler, resolving with what the handler observed. */
  function driveMiddleware(req: AuthRequest, observe: () => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const terminal: Handler = (_req, _res, next) => {
        try {
          resolve(observe());
        } catch (err) {
          reject(err);
        }
        next();
      };
      tenantContextMiddleware(req, {} as never, (err?: unknown) => {
        if (err) return reject(err);
        terminal(req, {}, () => undefined);
      });
    });
  }

  await test('the middleware establishes a tenant context for downstream handlers', async () => {
    const req = fakeRequest({ organizationId: ORG_A, allowedClinicIds: [CLINIC_A1, CLINIC_A2] });
    const seen = await driveMiddleware(req, () => requireTenantContext());
    const ctx = seen as ReturnType<typeof requireTenantContext>;
    assert.equal(ctx.organizationId, ORG_A);
    assert.deepEqual([...explicitClinicIds(ctx.clinicScope)], [CLINIC_A1, CLINIC_A2]);
    assert.equal(ctx.actor.kind, 'USER');
    assert.equal(ctx.correlationId, 'req-1');
  });

  await test('canAccessAllClinics becomes ORGANIZATION_WIDE, not a copy of allowedClinicIds', async () => {
    // The regression this pins: an OWNER whose UserClinic rows are empty is
    // org-wide, and copying allowedClinicIds would silently scope them to
    // nothing.
    const req = fakeRequest({ organizationId: ORG_A, canAccessAllClinics: true, allowedClinicIds: [] });
    const ctx = (await driveMiddleware(req, () => requireTenantContext())) as ReturnType<typeof requireTenantContext>;
    assert.equal(ctx.clinicScope.kind, 'ORGANIZATION_WIDE');
  });

  await test('the middleware ignores client-supplied clinic selection entirely', async () => {
    const req = fakeRequest({ organizationId: ORG_A, allowedClinicIds: [CLINIC_A1] });
    (req as unknown as { headers: Record<string, string> }).headers = { 'x-clinic-id': CLINIC_B1 };
    (req as unknown as { query: Record<string, string> }).query = { clinicId: CLINIC_B1 };
    const ctx = (await driveMiddleware(req, () => requireTenantContext())) as ReturnType<typeof requireTenantContext>;
    assert.deepEqual([...explicitClinicIds(ctx.clinicScope)], [CLINIC_A1]);
    assert.equal(ctx.organizationId, ORG_A);
  });

  await test('a request without req.user passes through with no context established', async () => {
    const req = { id: 'req-anon' } as unknown as AuthRequest;
    const seen = await driveMiddleware(req, () => getExecutionContext());
    assert.equal(seen, undefined);
  });

  await test('the clinic id list is copied, so mutating req.user afterwards cannot widen the context', async () => {
    const req = fakeRequest({ organizationId: ORG_A, allowedClinicIds: [CLINIC_A1] });
    const ctx = (await driveMiddleware(req, () => requireTenantContext())) as ReturnType<typeof requireTenantContext>;
    req.user!.allowedClinicIds.push(CLINIC_B1);
    assert.deepEqual([...explicitClinicIds(ctx.clinicScope)], [CLINIC_A1]);
  });

  await test('two concurrent requests through the middleware stay isolated', async () => {
    const [a, b] = await Promise.all([
      driveMiddleware(fakeRequest({ organizationId: ORG_A, allowedClinicIds: [CLINIC_A1] }), async () => {
        await tick(4);
        return requireTenantContext().organizationId;
      }),
      driveMiddleware(fakeRequest({ organizationId: ORG_B, allowedClinicIds: [CLINIC_B1] }), async () => {
        await tick(2);
        return requireTenantContext().organizationId;
      }),
    ]);
    assert.equal(await a, ORG_A);
    assert.equal(await b, ORG_B);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
