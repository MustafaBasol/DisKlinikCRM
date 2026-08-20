import * as ts from 'typescript';
import { REMEDIATION, type RuleId, type SuppressedViolation, type Violation } from './types.js';
import { computeFingerprint } from './fingerprint.js';

/**
 * F3-IMPL-007 rule engine.
 *
 * Scope decision (see evidence doc §3): this is an AST walk over a single
 * file's syntax tree, with NO type checker / ts.Program. That keeps it fast
 * and dependency-free, at the cost of using name-based (not type-based)
 * identification for "is this an error value" / "is this a safe helper
 * call". Every name list below is deliberately narrow and documented, per
 * the task brief's "low false-positive risk" requirement — this is not a
 * general dataflow analysis and does not attempt to be one.
 */

// Exact identifier names this codebase's `.catch()`/reject-handler function
// *parameters* universally use for the rejection value (confirmed by repo
// grep before writing this rule; see evidence doc §2). Deliberately
// exact-match, not a prefix/suffix regex, so `errorName`/`errorCode`/
// `safeErr`/`lastError` never match. Used ONLY for function/arrow-function
// parameter tracking in `visit()` below — a function parameter needs a
// name-based signal to tell a `.catch(err => ...)` handler apart from an
// unrelated callback (F3-IMPL-007-R1: kept conservative per review — no
// deterministic evidence a same-shaped arrow/function param not named
// `err`/`error` is actually an error handler).
//
// `catch (...) {}` clause bindings are a DIFFERENT, unconditional case (see
// `visit()`'s `ts.isCatchClause` branch): syntax alone guarantees a catch
// binding is the caught value regardless of its name, so `catch (e)`,
// `catch (ex)`, `catch (caught)`, `catch (failure)` etc. are all tracked by
// their actual identifier — this set is not consulted there.
const ERROR_PARAM_NAMES = new Set(['err', 'error']);

// error.<x> access considered a leak (F3-IMPL-004/006's exact remediated
// class): message/stack can carry request-derived text (see
// server/src/utils/logger.ts's safeErrorLog doc comment); cause is the
// ES2022 chained-cause field with the same risk.
const DANGEROUS_ERROR_PROPS = new Set(['message', 'stack', 'cause']);
// error.<x> access explicitly accepted safe (matches safeErrorFields()'s own
// returned shape and the codebase's `err.name`-only mail-catch convention).
const SAFE_ERROR_PROPS = new Set(['name', 'code']);

// Safe-wrapper call allowlist: an expression tree rooted at one of these
// calls is treated as opaque (not descended into) — the call itself is the
// accepted redaction/summarization boundary. R1 review finding: a
// `/^(redact|summarize)[A-Z]/` *prefix* match was previously accepted here
// as an alternative to this exact list — that trusted any function whose
// name merely started with "redact"/"summarize" without the name itself
// ever having been reviewed (e.g. `redactPatientAttachments`/
// `redactPatientImagingImages`/`redactPatientMedicalHistory`/
// `redactActivityDescription` in server/src/services/privacy/
// patientAnonymization.ts are unrelated DB-anonymization functions — none
// returns a log-safe string, and the prefix match would have silently
// trusted a call to any of them as if it were a log-redaction boundary).
// This is now an exact-name-only allowlist: the four helper names
// documented in F3-IMPL-006's evidence (§2), plus every `redact*`/
// `summarize*`-named helper actually confirmed — by instrumenting a real
// scan run against this baseline (main @
// 6f7e580d1bab2a0f87baed1cfe5ec0a944a6b711) and recording every callee name
// that previously matched only the now-removed prefix regex while its call
// site was reached from a logger/console sink's arguments — to be a
// currently-relied-upon log-argument wrapper: `redactPhone`
// (server/src/jobs/reminders.ts, server/src/routes/whatsapp.ts,
// server/src/services/whatsapp/metaWhatsAppAiProcessor.ts,
// server/src/services/whatsappBookingFlow.ts), `redactSensitiveText`
// (server/src/services/googleAiStudio.ts, server/src/services/privacy/
// redaction.ts, server/src/services/whatsappAgentPrompt.ts,
// server/src/services/whatsappConversationAgent.ts,
// server/src/services/whatsappStepAwareNlu.ts), `redactMetaBody`
// (server/src/services/instagram/InstagramMessagingProvider.ts),
// `summarizeTextForLog` (server/src/routes/whatsapp.ts,
// server/src/services/whatsappBookingFlow.ts), `summarizeIdentifier`
// (server/src/routes/whatsapp.ts, server/src/routes/instagramInbox.ts,
// server/src/services/instagram/instagramClinicResolver.ts,
// server/src/services/instagram/instagramAiConversationProcessor.ts),
// `summarizeProviderId` (server/src/routes/instagramWebhook.ts,
// server/src/routes/metaWhatsAppWebhook.ts), `summarizeConnectionIdentifiers`
// (server/src/routes/instagramWebhook.ts), `summarizeId`
// (server/src/services/whatsapp/metaWhatsAppAiProcessor.ts). Naming a new
// function `redactX`/`summarizeX` no longer grants automatic trust — it
// must be added to this list by name, in a reviewable diff, exactly like
// any other entry. A callee NOT in this exact set is no longer opaque (see
// `inspectValue`'s `ts.isCallExpression` branch below).
const SAFE_WRAPPER_EXACT_NAMES = new Set([
  'safeErrorFields',
  'safeErrorLog',
  'boundedErrorType',
  'senderSuffix',
  'redactPhone',
  'redactSensitiveText',
  'redactMetaBody',
  'summarizeTextForLog',
  'summarizeIdentifier',
  'summarizeProviderId',
  'summarizeConnectionIdentifiers',
  'summarizeId',
]);

// Closed vocabulary for message-content variables, taken directly from the
// F3-IMPL-006 evidence doc's named MESSAGE_CONTENT_REQUIRES_REMOVAL sites
// (rawMessage, message.text, lastMessageText). Deliberately not a generic
// "text"/"content"/"body" ban — see evidence doc §3C for why.
const MESSAGE_CONTENT_IDENTIFIER_NAMES = new Set([
  'rawMessage',
  'rawPayload',
  'messageText',
  'lastMessageText',
]);
const MESSAGE_CONTENT_BASE_NAMES = new Set([
  'message',
  'msg',
  'lastMessage',
  'inboundMessage',
  'outboundMessage',
  'payload',
]);
const MESSAGE_CONTENT_PROP_NAMES = new Set(['text', 'body']);

// Names whose VALUE is direct PII and must never reach a log sink raw.
//
// Originally limited to the two fields this codebase already has a dedicated,
// well-established redaction helper for (redactPhone) or an unambiguous
// always-PII name (email) — see evidence doc §3D for why firstName/lastName/
// patientName were judged too false-positive-prone for name-only matching and
// remain deliberately EXCLUDED from this automated rule (that reasoning is
// unchanged: a `firstName` on a staff/user/template object is common enough
// that name-only matching would produce noise the gate cannot act on).
//
// F3-DATA-MIG-003 / G-E4 extends the set with national/travel identity and
// clinic chart identifiers. A T.C. Kimlik No is the most sensitive field in
// the product — immutable, lifelong, government-issued, and unreissuable if
// leaked — yet this guard was SILENTLY GREEN on it: none of these names
// existed in the set, so `console.error('lookup failed', tcNo)` would have
// passed the gate. chartNumber joins them because it is a re-identification
// vector against the clinic's physical paper archive. Unlike firstName, every
// one of these names is unambiguously an identity value in this codebase —
// there is no benign object property called `tckn` — so they carry the same
// low false-positive profile as `email`/`phone`.
//
// F3-DATA-MIG-TODAY-001-R10 adds `district` and `normalizedValue`.
//   - `district` (Patient.district, the Turkish ilçe) is address PII and a
//     sharper quasi-identifier than the province already in `city`: a district
//     narrows a population to thousands. There is no benign `district` in this
//     codebase — the only declaration is the patient address column.
//   - `normalizedValue` is the digits-only projection of a PatientContactPoint
//     phone number, i.e. a phone number with the formatting removed. It is
//     already covered in spirit by `phone`, but not by name, so a
//     `console.error('...', normalizedValue)` would have passed this gate
//     while logging the exact digits `redactPhone` exists to hide. The name is
//     unambiguous here: its only declarations are the contact-point column and
//     the identity-crypto lookup input (patientIdentityCrypto.ts), and BOTH
//     are values that must never be logged.
//
// `value` (PatientContactPoint.value, MigrationPreservedSourceValue.value) is
// DELIBERATELY NOT added despite being the rawest PII of the three. It is a
// pervasive generic identifier/property name across this codebase — settings
// values, enum values, parsed values, form values — so name-only matching on
// it would produce mass false positives the gate could not act on, and a gate
// that must be baseline-suppressed everywhere protects nothing. This is the
// same judgment already recorded above for firstName/lastName/patientName.
// The narrow-name entries here are the part that can actually be enforced.
const DIRECT_PII_IDENTIFIER_NAMES = new Set([
  'email',
  'phone',
  'nationalId',
  'nationalIdNumber',
  'tcNo',
  'tckn',
  'identityNumber',
  'passportNumber',
  'chartNumber',
  'district',
  'normalizedValue',
]);

const CONSOLE_SINK_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug']);
const LOGGER_SINK_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'fatal', 'trace']);

const SUPPRESS_MARKER = /log-privacy-guard:allow(?:\s*--\s*(.+))?/;

export interface ScanFileOutcome {
  violations: Violation[];
  suppressed: SuppressedViolation[];
}

// Matches `./logger.js`/`../utils/logger.js`/`../../utils/logger` etc — any
// relative specifier whose final path segment (basename, extension
// stripped) is exactly "logger". Relative-only (must start with ".") so an
// unrelated same-named external package can never match. Deliberately NOT
// just `/utils\/logger$/`: a file inside utils/ itself (e.g.
// errorTracking.ts) imports its sibling as `./logger.js`, which contains no
// "utils/" segment at all — see evidence doc §5 (this was caught by a live
// drift-injection check against server/src/utils/*.ts before this rule
// shipped, not by the baseline scan, which had zero utils/ hits to begin
// with and so couldn't reveal the gap on its own).
const LOGGER_MODULE_SPECIFIER_RE = /(?:^|\/)logger(?:\.(js|ts))?$/;

function findLoggerLocalName(sourceFile: ts.SourceFile): string | null {
  let localName: string | null = null;
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const specifier = stmt.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    if (!LOGGER_MODULE_SPECIFIER_RE.test(specifier)) continue;
    const namedBindings = stmt.importClause?.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        const importedName = (el.propertyName ?? el.name).text;
        if (importedName === 'logger') localName = el.name.text;
      }
    }
  }
  return localName;
}

function isSafeWrapperCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  let name: string | null = null;
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
  if (!name) return false;
  return SAFE_WRAPPER_EXACT_NAMES.has(name);
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

export function scanFile(absPath: string, relPosixPath: string, sourceText: string): ScanFileOutcome {
  const sourceFile = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const lines = sourceText.split(/\r\n|\r|\n/);
  const loggerLocalName = findLoggerLocalName(sourceFile);

  const violations: Violation[] = [];
  const suppressed: SuppressedViolation[] = [];

  // Refcounted stack of "currently in scope" error-like identifier names —
  // handles nested catch/handler scopes with the same name shadowing
  // correctly without a full scope/binding resolver.
  const errorScopeCounts = new Map<string, number>();
  const isErrorLike = (name: string) => (errorScopeCounts.get(name) ?? 0) > 0;
  const enterErrorScope = (name: string) => errorScopeCounts.set(name, (errorScopeCounts.get(name) ?? 0) + 1);
  const exitErrorScope = (name: string) => errorScopeCounts.set(name, (errorScopeCounts.get(name) ?? 0) - 1);

  function lineTextAt(line1: number): string {
    return lines[line1 - 1] ?? '';
  }

  function record(ruleId: RuleId, node: ts.Node) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const line = pos.line + 1;
    const column = pos.character + 1;
    const lineText = lineTextAt(line).trim();
    const fingerprint = computeFingerprint(relPosixPath, ruleId, lineText);
    const violation: Violation = {
      ruleId,
      file: relPosixPath,
      line,
      column,
      snippet: lineText,
      fingerprint,
      remediation: REMEDIATION[ruleId],
    };

    const thisLineSuppression = lineTextAt(line).match(SUPPRESS_MARKER);
    const prevLineSuppression = lineTextAt(line - 1).match(SUPPRESS_MARKER);
    const match = thisLineSuppression ?? prevLineSuppression;
    const reason = match?.[1]?.trim();
    if (reason && reason.length >= 10) {
      suppressed.push({ ...violation, suppressionReason: reason });
      return;
    }
    violations.push(violation);
  }

  function inspectValue(node: ts.Expression) {
    const n = unwrap(node);

    if (ts.isSpreadElement(n)) {
      inspectValue(n.expression);
      return;
    }

    if (ts.isIdentifier(n)) {
      if (isErrorLike(n.text)) {
        record('RAW_ERROR_OBJECT', n);
        return;
      }
      if (MESSAGE_CONTENT_IDENTIFIER_NAMES.has(n.text)) {
        record('MESSAGE_CONTENT', n);
        return;
      }
      if (DIRECT_PII_IDENTIFIER_NAMES.has(n.text)) {
        record('DIRECT_PII_FIELD', n);
        return;
      }
      return;
    }

    if (ts.isPropertyAccessExpression(n)) {
      const objName = ts.isIdentifier(n.expression) ? n.expression.text : null;
      const prop = n.name.text;
      if (objName && isErrorLike(objName)) {
        if (DANGEROUS_ERROR_PROPS.has(prop)) record('ERROR_DANGEROUS_PROPERTY', n);
        return; // SAFE_ERROR_PROPS or any other property of an error-like var: leaf, no further descent
      }
      if (objName && MESSAGE_CONTENT_BASE_NAMES.has(objName) && MESSAGE_CONTENT_PROP_NAMES.has(prop)) {
        record('MESSAGE_CONTENT', n);
        return;
      }
      if (objName && DIRECT_PII_IDENTIFIER_NAMES.has(prop)) {
        record('DIRECT_PII_FIELD', n);
        return;
      }
      return;
    }

    if (ts.isCallExpression(n)) {
      if (isSafeWrapperCall(n)) return; // allowlisted safe boundary — do not descend into its arguments
      // F3-IMPL-007-R1: a call NOT on the exact safe-wrapper allowlist is no
      // longer trusted by omission — its own arguments are inspected the
      // same as any other value position, so `unknownHelper(err)` /
      // `redactWhatever(err)` / `summarizeWhatever(err)` still surfaces the
      // raw error-like/PII value passed into it. Prior behavior treated
      // every call expression as an opaque leaf regardless of allowlist
      // membership, which made the allowlist a no-op — this closes that gap
      // (review finding: "a deliberately unsafe pass-through helper name
      // cannot bypass detection merely via naming").
      for (const arg of n.arguments) inspectValue(arg);
      return;
    }

    if (ts.isObjectLiteralExpression(n)) {
      for (const prop of n.properties) {
        if (ts.isPropertyAssignment(prop)) inspectValue(prop.initializer);
        else if (ts.isShorthandPropertyAssignment(prop)) inspectValue(prop.name);
        else if (ts.isSpreadAssignment(prop)) inspectValue(prop.expression);
      }
      return;
    }

    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) {
        if (ts.isExpression(el)) inspectValue(el);
      }
      return;
    }

    if (ts.isConditionalExpression(n)) {
      inspectValue(n.whenTrue);
      inspectValue(n.whenFalse);
      return;
    }

    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      inspectValue(n.left);
      inspectValue(n.right);
      return;
    }

    if (ts.isTemplateExpression(n)) {
      for (const span of n.templateSpans) inspectValue(span.expression);
      return;
    }
    // Any other expression shape (literals, comparisons, arithmetic,
    // function/arrow expressions, `typeof`/`instanceof` operands, etc.) is a
    // deliberate stop: see module doc — this is a bounded value-shape
    // descent, not a general dataflow analysis.
  }

  function matchSink(node: ts.CallExpression): boolean {
    if (!ts.isPropertyAccessExpression(node.expression)) return false;
    const obj = node.expression.expression;
    const method = node.expression.name.text;
    if (!ts.isIdentifier(obj)) return false;
    if (obj.text === 'console' && CONSOLE_SINK_METHODS.has(method)) return true;
    if (loggerLocalName && obj.text === loggerLocalName && LOGGER_SINK_METHODS.has(method)) return true;
    return false;
  }

  function visit(node: ts.Node) {
    if (ts.isCatchClause(node)) {
      // A catch-clause binding is, by syntax alone, always the caught
      // value — unlike a function parameter, no name-based allowlist is
      // needed (or correct) here. `catch (e)`, `catch (ex)`, `catch
      // (caught)` etc. must all be tracked, not just `catch (err)`/`catch
      // (error)`. Only a destructured/omitted binding (`catch ({ code })`,
      // `catch {}`) has no identifier to track, which is fine — there is no
      // single caught-value variable to leak in that shape.
      const decl = node.variableDeclaration;
      const name = decl && ts.isIdentifier(decl.name) ? decl.name.text : null;
      if (name) enterErrorScope(name);
      ts.forEachChild(node, visit);
      if (name) exitErrorScope(name);
      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      const tracked: string[] = [];
      for (const p of node.parameters) {
        if (ts.isIdentifier(p.name) && ERROR_PARAM_NAMES.has(p.name.text)) {
          enterErrorScope(p.name.text);
          tracked.push(p.name.text);
        }
      }
      ts.forEachChild(node, visit);
      for (const name of tracked) exitErrorScope(name);
      return;
    }

    if (ts.isCallExpression(node) && matchSink(node)) {
      for (const arg of node.arguments) inspectValue(arg);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { violations, suppressed };
}
