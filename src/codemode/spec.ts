import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpMethod, LoadedSpec, MatchedOperation, SpecOperation } from './types.js';

// Slash-command permission endpoints: the spec marks them `BotToken | OAuth2`, but in practice
// they require an OAuth2 Bearer token and a bot token is rejected, so they are never exposed.
export const EXCLUDED_OPERATION_IDS: ReadonlySet<string> = new Set([
  'list_guild_application_command_permissions',
  'get_guild_application_command_permissions',
  'set_guild_application_command_permissions',
]);

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SCHEMA_REF_PREFIX = '#/components/schemas/';

type Json = unknown;
type JsonObject = Record<string, Json>;

interface RawOperation extends JsonObject {
  operationId: string;
  security?: Array<Record<string, unknown>>;
}

interface RawSpec {
  paths: Record<string, JsonObject>;
  components: { schemas: Record<string, Json> };
}

// ---------------------------------------------------------------------------
// $ref handling
// ---------------------------------------------------------------------------

/** Deep copy with every `{ $ref: "#/components/schemas/X" }` rewritten to `{ $ref: "X" }`. */
function bareRefs(node: Json): Json {
  if (Array.isArray(node)) return node.map(bareRefs);
  if (node === null || typeof node !== 'object') return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node as JsonObject)) {
    if (key === '$ref' && typeof value === 'string') {
      out[key] = value.startsWith(SCHEMA_REF_PREFIX) ? value.slice(SCHEMA_REF_PREFIX.length) : value;
    } else {
      out[key] = bareRefs(value);
    }
  }
  return out;
}

/** Expand a top-level schema ref one level; any deeper ref stays as a bare-name ref. */
function expandOnce(node: Json, schemas: Record<string, Json>): Json {
  const ref = node && typeof node === 'object' ? (node as JsonObject).$ref : undefined;
  if (typeof ref === 'string' && ref.startsWith(SCHEMA_REF_PREFIX)) {
    const target = schemas[ref.slice(SCHEMA_REF_PREFIX.length)];
    if (target !== undefined) return bareRefs(target);
  }
  return bareRefs(node);
}

// ---------------------------------------------------------------------------
// Operation building
// ---------------------------------------------------------------------------

function isBotTokenOperation(op: RawOperation): boolean {
  const security = Array.isArray(op.security) ? op.security : [];
  return security.some((entry) => entry && typeof entry === 'object' && 'BotToken' in entry);
}

function mergeParameters(pathLevel: Json, opLevel: Json, schemas: Record<string, Json>): JsonObject[] {
  const merged = new Map<string, JsonObject>();
  for (const list of [pathLevel, opLevel]) {
    if (!Array.isArray(list)) continue;
    for (const param of list as JsonObject[]) {
      const expanded: JsonObject = { ...param };
      if (param.schema !== undefined) expanded.schema = expandOnce(param.schema, schemas);
      merged.set(`${String(param.in)}:${String(param.name)}`, bareRefs(expanded) as JsonObject);
    }
  }
  return [...merged.values()];
}

function jsonSchemaOf(content: Json): { contentType: string; schema: Json } | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const entries = Object.entries(content as Record<string, JsonObject>);
  const picked = entries.find(([type]) => type === 'application/json') ?? entries[0];
  if (!picked || picked[1].schema === undefined) return undefined;
  return { contentType: picked[0], schema: picked[1].schema };
}

function buildRequestBody(body: Json, schemas: Record<string, Json>): JsonObject | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const found = jsonSchemaOf((body as JsonObject).content);
  if (!found) return undefined;
  return {
    required: (body as JsonObject).required === true,
    contentType: found.contentType,
    schema: expandOnce(found.schema, schemas),
  };
}

function buildResponse(responses: Json, schemas: Record<string, Json>): JsonObject | undefined {
  if (!responses || typeof responses !== 'object') return undefined;
  const status = Object.keys(responses as JsonObject)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0];
  if (!status) return undefined;
  const found = jsonSchemaOf(((responses as JsonObject)[status] as JsonObject).content);
  return found ? { status, schema: expandOnce(found.schema, schemas) } : { status };
}

function buildOperationDoc(raw: RawOperation, pathLevelParams: Json, schemas: Record<string, Json>): JsonObject {
  const doc: JsonObject = { operationId: raw.operationId };
  if (raw.summary !== undefined) doc.summary = raw.summary;
  if (raw.description !== undefined) doc.description = raw.description;
  doc.parameters = mergeParameters(pathLevelParams, raw.parameters, schemas);
  const requestBody = buildRequestBody(raw.requestBody, schemas);
  if (requestBody) doc.requestBody = requestBody;
  const response = buildResponse(raw.responses, schemas);
  if (response) doc.response = response;
  return doc;
}

interface Built {
  operations: SpecOperation[];
  sandboxJson: string;
}

function buildSpec(raw: RawSpec): Built {
  const schemas = raw.components.schemas;
  const operations: SpecOperation[] = [];
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const [template, item] of Object.entries(raw.paths)) {
    for (const method of METHODS) {
      const rawOp = item[method.toLowerCase()] as RawOperation | undefined;
      if (!rawOp || !isBotTokenOperation(rawOp) || EXCLUDED_OPERATION_IDS.has(rawOp.operationId)) continue;
      operations.push({ operationId: rawOp.operationId, method, pathTemplate: template });
      (paths[template] ??= {})[method.toLowerCase()] = buildOperationDoc(rawOp, item.parameters, schemas);
    }
  }
  const sandboxJson = JSON.stringify({ paths, schemas: bareRefs(schemas) });
  return { operations, sandboxJson };
}

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

interface CompiledTemplate {
  op: SpecOperation;
  /** Literal text, or null for a `{param}` segment. */
  literals: Array<string | null>;
  names: Array<string | null>;
  literalCount: number;
}

const PATH_CHARS = /^[A-Za-z0-9_\-.~@:%/]+$/;
const PARAM_VALUE = /^(?:[A-Za-z0-9_\-.~@:]|%[0-9A-Fa-f]{2})+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000- \u007f]/;

function compileTemplate(op: SpecOperation): CompiledTemplate {
  const segments = op.pathTemplate.split('/').slice(1);
  const isParam = (s: string): boolean => /^\{.+\}$/.test(s);
  const literals = segments.map((s) => (isParam(s) ? null : s));
  const names = segments.map((s) => (isParam(s) ? s.slice(1, -1) : null));
  return { op, literals, names, literalCount: literals.filter((l) => l !== null).length };
}

/** Index: `METHOD:segmentCount` -> templates sorted by literal count, most specific first. */
function buildIndex(operations: SpecOperation[]): Map<string, CompiledTemplate[]> {
  const index = new Map<string, CompiledTemplate[]>();
  for (const op of operations) {
    const compiled = compileTemplate(op);
    const key = `${op.method}:${compiled.literals.length}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(compiled);
    else index.set(key, [compiled]);
  }
  for (const bucket of index.values()) bucket.sort((a, b) => b.literalCount - a.literalCount);
  return index;
}

/** Split a request path into raw segments, or null when it fails the structural guard. */
function safeSegments(requestPath: string): string[] | null {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) return null;
  if (CONTROL_OR_SPACE.test(requestPath) || !PATH_CHARS.test(requestPath)) return null;
  const segments = requestPath.split('/').slice(1);
  for (const segment of segments) {
    if (segment === '') return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || CONTROL_OR_SPACE.test(decoded)) {
      return null;
    }
  }
  return segments;
}

function tryTemplate(tpl: CompiledTemplate, segments: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const literal = tpl.literals[i];
    if (literal !== null) {
      if (literal !== segments[i]) return null;
    } else if (!PARAM_VALUE.test(segments[i])) {
      return null;
    } else {
      params[tpl.names[i] as string] = segments[i];
    }
  }
  return params;
}

function makeMatcher(operations: SpecOperation[]): LoadedSpec['match'] {
  const index = buildIndex(operations);
  return (method, requestPath): MatchedOperation | null => {
    const segments = safeSegments(requestPath);
    if (!segments) return null;
    for (const tpl of index.get(`${method}:${segments.length}`) ?? []) {
      const pathParams = tryTemplate(tpl, segments);
      if (pathParams) return { op: tpl.op, pathParams };
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Walk up from this module to the directory holding package.json (works from src/ and dist/). */
function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('discord-mcp package root not found');
    dir = parent;
  }
}

/**
 * Load the pinned Discord OpenAPI snapshot. Path values in `MatchedOperation.pathParams`
 * are returned exactly as they appear in the request path (still percent-encoded).
 */
export function loadSpec(specPath?: string): LoadedSpec {
  const file = specPath ?? path.join(findPackageRoot(), 'spec', 'discord-openapi.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawSpec;
  const { operations, sandboxJson } = buildSpec(raw);
  return { operations, sandboxJson, match: makeMatcher(operations) };
}
