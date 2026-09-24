/**
 * ApiLens Intermediate Representation (IR).
 *
 * Every language extractor (TypeScript, Java, and future languages) produces
 * a Manifest built from these types. The core engine (index-store, diff,
 * impact analysis, AI verification) only ever depends on this file, never on
 * a specific extractor implementation. Adding support for a new language
 * means writing a new extractor that emits these shapes - nothing here
 * should need to change.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

// ---------------------------------------------------------------------------
// Frontend IR (Phase 1 scope)
// ---------------------------------------------------------------------------

export interface ImportInfo {
  source: string;
  specifiers: string[];
  location: SourceLocation;
}

export interface FileInfo {
  path: string;
  imports: ImportInfo[];
  exports: string[];
}

export interface FunctionParamInfo {
  name: string;
  type: string | null;
}

export interface FunctionInfo {
  id: string;
  name: string;
  file: string;
  params: FunctionParamInfo[];
  returnType: string | null;
  calls: string[];
  location: SourceLocation;
  containingComponent: string | null;
}

/**
 * How an API call's endpoint was determined:
 * - direct:  the call itself is axios.* / fetch with a statically resolvable URL
 * - wrapper: a call to a function whose return value comes from an API call (e.g. getUser(id))
 * - config:  mapped explicitly via apilens.config.json `apiClientMap`
 */
export type ApiCallResolution = "direct" | "wrapper" | "config";

export interface ApiCallInfo {
  id: string;
  /** Normalized path pattern, e.g. "/users/{param}". Null when not statically resolvable. */
  endpointPattern: string | null;
  method: HttpMethod | null;
  /** Raw callee expression, e.g. "axios.get" or "userApi.getUser". Preserved even when endpoint is unresolved. */
  calleeExpression: string;
  resolution: ApiCallResolution;
  callerFunctionId: string | null;
  file: string;
  location: SourceLocation;
  arguments: string[];
  returnVarType: string | null;
  code: string;
}

/**
 * - direct:  the accessed value is provably the API response body (or a sub-part of it)
 * - derived: the value passed through a function ApiLens could not follow (e.g. transform(user)),
 *            so the path is relative to that function's result, not the response body
 */
export type DataFlowKind = "direct" | "derived";

export interface PropertyAccessInfo {
  id: string;
  apiCallId: string;
  /** Source text of the accessed root expression, e.g. "user". */
  object: string;
  /** Path relative to the response body, e.g. ["profile", "email"]. "[]" denotes an array element. */
  path: string[];
  flow: DataFlowKind;
  file: string;
  location: SourceLocation;
  containingFunctionId: string | null;
  containingComponent: string | null;
  code: string;
}

export interface FrontendManifest {
  language: "typescript";
  rootDir: string;
  generatedAt: string;
  files: FileInfo[];
  functions: FunctionInfo[];
  apiCalls: ApiCallInfo[];
  propertyAccesses: PropertyAccessInfo[];
}

// ---------------------------------------------------------------------------
// Backend IR (schema stable now, populated starting Phase 2)
// ---------------------------------------------------------------------------

export interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  source: "path" | "query" | "body" | "header";
}

export interface DtoFieldInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DtoInfo {
  id: string;
  name: string;
  fields: DtoFieldInfo[];
  location: SourceLocation;
}

export interface DtoRef {
  dtoId: string;
  /** true when the type is a collection of the referenced DTO, e.g. List<UserResponse>. */
  isArray: boolean;
}

export interface EndpointInfo {
  id: string;
  method: HttpMethod;
  path: string;
  requestParams: ParamInfo[];
  requestBody: DtoRef | null;
  responseType: DtoRef | null;
  location: SourceLocation;
}

export interface BackendManifest {
  language: "java";
  rootDir: string;
  generatedAt: string;
  endpoints: EndpointInfo[];
  dtos: DtoInfo[];
}
