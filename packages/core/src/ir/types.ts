/**
 * Tacet Intermediate Representation (IR).
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
  /** Project file the import resolves to (tsconfig paths applied), or null for packages / unresolved. */
  resolvedFile: string | null;
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
 * - config:  mapped explicitly via tacet.config.json `apiClientMap`
 */
export type ApiCallResolution = "direct" | "wrapper" | "config";

/** Statically known request keys. `null` means Tacet could not determine them (e.g. a variable was passed). */
export interface RequestShape {
  queryKeys: string[] | null;
  bodyKeys: string[] | null;
}

export interface ApiCallInfo {
  id: string;
  /** Normalized path pattern, e.g. "/users/{param}". Null when not statically resolvable. */
  endpointPattern: string | null;
  method: HttpMethod | null;
  /** Raw callee expression, e.g. "axios.get" or "userApi.getUser". Preserved even when endpoint is unresolved. */
  calleeExpression: string;
  resolution: ApiCallResolution;
  /** For `wrapper` calls: the API client function being called, e.g. the id of `getUser`. */
  wrapperFunctionId: string | null;
  callerFunctionId: string | null;
  file: string;
  location: SourceLocation;
  arguments: string[];
  request: RequestShape;
  returnVarType: string | null;
  code: string;
}

/**
 * - direct:  the accessed value is provably the API response body (or a sub-part of it)
 * - derived: the value passed through a function Tacet could not follow (e.g. transform(user)),
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
// Backend IR (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Structural description of a serialized (JSON) type. Recursive so the diff
 * engine can compare request/response shapes field by field, regardless of
 * which backend language produced them.
 */
export type TypeRef =
  /** string, number, boolean, date-like values. `name` is the source-language type, e.g. "Long". */
  | { kind: "scalar"; name: string }
  | { kind: "dto"; dtoId: string; typeArguments: TypeRef[] }
  | { kind: "enum"; enumId: string }
  | { kind: "array"; element: TypeRef }
  | { kind: "map"; value: TypeRef }
  /** A generic parameter of the enclosing DTO, e.g. `T` in `ApiResponse<T>`. */
  | { kind: "typeParameter"; name: string }
  /** A type Tacet could not resolve (e.g. from an external library). */
  | { kind: "unknown"; name: string };

export interface ParamInfo {
  name: string;
  type: TypeRef;
  required: boolean;
  source: "path" | "query" | "header";
}

export interface DtoFieldInfo {
  /** Serialized (JSON) name, after @JsonProperty etc. */
  name: string;
  type: TypeRef;
  nullable: boolean;
}

export interface DtoInfo {
  /** Fully qualified name, e.g. "com.example.user.UserResponse". */
  id: string;
  name: string;
  typeParameters: string[];
  fields: DtoFieldInfo[];
  location: SourceLocation;
}

export interface EnumInfo {
  id: string;
  name: string;
  values: string[];
  location: SourceLocation;
}

export interface EndpointInfo {
  /** `${method} ${path}`, e.g. "GET /users/{id}". */
  id: string;
  method: HttpMethod;
  /** Path as declared in the backend, e.g. "/users/{id}". */
  path: string;
  /** Source-level handler, e.g. "com.example.user.UserController#getUser". */
  handler: string;
  requestParams: ParamInfo[];
  requestBody: { type: TypeRef; required: boolean } | null;
  /** Null when the handler returns no body (void, ResponseEntity<Void>). */
  response: TypeRef | null;
  location: SourceLocation;
}

export type BackendLanguage = "java";

export interface BackendManifest {
  language: BackendLanguage;
  rootDir: string;
  generatedAt: string;
  endpoints: EndpointInfo[];
  /** DTOs reachable from endpoint requests/responses. */
  dtos: DtoInfo[];
  enums: EnumInfo[];
  /** Things the extractor could not analyze precisely (parse errors, unresolved constants, ...). */
  warnings: string[];
}
