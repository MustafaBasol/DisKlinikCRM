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

// Exact identifier names this codebase's catch clauses and .catch()/reject
// handlers universally use for the caught value (confirmed by repo grep
// before writing this rule; see evidence doc §2). Deliberately exact-match,
// not a prefix/suffix regex, so `errorName`/`errorCode`/`safeErr`/`lastError`
// never match.
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
// accepted redaction/summarization boundary. Combines the exact helper names
// documented in F3-IMPL-006's evidence (§2) with the two naming conventions
// (`redact*`, `summarize*`) that codebase already uses for every other
// per-file helper of this kind (instagramAiConversationProcessor.ts,
// whatsapp.ts, instagramClinicResolver.ts, metaWhatsAppWebhook.ts,
// instagramWebhook.ts, instagramInbox.ts — see evidence doc §2). This is the
// task's "narrow, explicit, reviewable" escape hatch for helper functions:
// naming a new function `redactX`/`summarizeX` is itself a reviewable signal
// in the PR diff, not a silent bypass.
const SAFE_WRAPPER_EXACT_NAMES = new Set([
  'safeErrorFields',
  'safeErrorLog',
  'boundedErrorType',
  'senderSuffix',
]);
const SAFE_WRAPPER_PREFIX = /^(redact|summarize)[A-Z]/;

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

// Deliberately limited to the two PII fields this codebase already has a
// dedicated, well-established redaction helper for (redactPhone) or an
// unambiguous always-PII name (email) — see evidence doc §3D for why
// firstName/lastName/patientName were judged too false-positive-prone for
// name-only matching and were left out of this automated rule.
const DIRECT_PII_IDENTIFIER_NAMES = new Set(['email', 'phone']);

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
  return SAFE_WRAPPER_EXACT_NAMES.has(name) || SAFE_WRAPPER_PREFIX.test(name);
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
      if (isSafeWrapperCall(n)) return; // opaque safe boundary — do not descend into its arguments
      return; // other calls: opaque by design (see module doc) — no descent
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
      const decl = node.variableDeclaration;
      const name = decl && ts.isIdentifier(decl.name) ? decl.name.text : null;
      const tracked = name && ERROR_PARAM_NAMES.has(name);
      if (tracked) enterErrorScope(name as string);
      ts.forEachChild(node, visit);
      if (tracked) exitErrorScope(name as string);
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
