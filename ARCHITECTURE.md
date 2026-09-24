# ApiLens Architecture

ApiLens는 Backend API 변경이 기존 Frontend 코드를 깨뜨릴 가능성을 배포 전에 탐지한다.
분석은 세 단계로 명확히 분리된다.

```text
1. API 변경을 정확하게 탐지            (Backend extractor + Diff engine)
2. 변경 API ↔ Frontend 코드를 정적 추적  (Frontend index + Impact engine)
3. 정적으로 확정하기 어려운 부분만 AI 검증 (AI verification layer)
```

AI는 핵심 분석 엔진이 아니라 Verification Layer이며, AI 없이도 1~2단계 결과는 항상 나온다.

---

## 1. Architecture

```text
                      ┌──────────────────────────┐
                      │    apilens CLI (Node/TS)  │
                      └────────────┬─────────────┘
                                   │
                      ┌────────────▼─────────────┐
                      │  @apilens/core            │
                      │  (language-agnostic)      │
                      │  - IR schema              │
                      │  - Index store (SQLite)   │
                      │  - Extractor protocol     │
                      │  - Diff / Impact  (P4/P5) │
                      │  - AI provider    (P6)    │
                      └───┬──────────────────┬────┘
                          │                  │
          ┌───────────────▼──────┐   ┌───────▼──────────────────┐
          │ extractor-typescript │   │ extractor-java  (Phase 2) │
          │ in-process, ts-morph │   │ subprocess, JavaParser JAR│
          └──────────────────────┘   └───────────────────────────┘
```

### 언어 확장 구조 (Extractor Protocol)

Core는 특정 언어를 모른다. 모든 extractor는 공통 IR(`packages/core/src/ir/types.ts`)로 된
**Manifest**를 산출하고, Core는 Manifest만 소비한다.

| 종류 | 실행 방식 | 예 |
|---|---|---|
| In-process | `LanguageExtractor` 인터페이스를 구현한 JS/TS 모듈 | TypeScript (ts-morph) |
| Out-of-process | `<command> <args...> <rootDir>` 실행 → stdout에 Manifest JSON 출력 | Java (JavaParser JAR), 추후 Python/Go/Kotlin 등 |

Out-of-process extractor는 `SubprocessExtractor`(`packages/core/src/extractor/subprocess-extractor.ts`)로
연결된다. 새 언어 지원 = 해당 언어로 extractor를 작성해 IR JSON을 출력하게 하는 것. Core 수정은 필요 없다.

## 2. Module structure

```text
packages/
├── core/                  언어 비종속 엔진
│   └── src/
│       ├── ir/            IR 타입 (Frontend + Backend manifest)
│       ├── index-store/   SQLite schema + repository
│       ├── extractor/     LanguageExtractor 인터페이스, SubprocessExtractor
│       └── ai/            AiProvider 인터페이스 (구현은 Phase 6)
├── extractor-typescript/  Phase 1: ts-morph 기반 Frontend 분석
│   └── src/
│       ├── analyzer.ts    데이터 흐름 추적 (symbol 기반)
│       ├── extractor.ts   Manifest 생성
│       ├── endpoint.ts    URL 표현식 → path pattern 정규화
│       └── config.ts      apilens.config.json
└── cli/                   apilens 바이너리
```

Phase 2에서 `packages/extractor-java/`(Gradle, JavaParser)가 추가된다. npm workspace에는 포함하지 않고
빌드된 JAR를 CLI가 `SubprocessExtractor`로 실행한다.

## 3. Data model (IR)

Frontend (Phase 1 구현):

| 타입 | 주요 필드 |
|---|---|
| `FileInfo` | path, imports, exports |
| `FunctionInfo` | id, name, params, returnType, calls, containingComponent |
| `ApiCallInfo` | endpointPattern, method, calleeExpression, **resolution**, callerFunctionId, location, arguments, returnVarType, code |
| `PropertyAccessInfo` | apiCallId, object, **path (response body 기준)**, **flow**, location, containingFunctionId, containingComponent, code |

- `resolution`: `direct`(axios/fetch 직접 호출) · `wrapper`(API 호출 결과를 반환하는 함수 호출, 예: `getUser(id)`) · `config`(apiClientMap)
- `path`: **응답 body 기준 경로**. `res.data.user.name`(axios)이나 `(await res.json()).user.name`(fetch) 모두 `["user","name"]`로 저장된다. 배열 원소는 `"[]"`. 따라서 Phase 5에서 DTO 필드와 바로 비교할 수 있다.
- `flow`: `direct`(응답 body임이 증명됨) · `derived`(추적 불가한 함수를 거침, 예: `transform(user).name`) → Phase 5에서 DEFINITE/POSSIBLE 판정의 근거가 된다.

Backend (타입만 정의, Phase 2에서 채움): `EndpointInfo`, `DtoInfo`, `DtoFieldInfo`, `ParamInfo`, `DtoRef`.

## 4. TypeScript AST 분석 방법 (구현됨)

ts-morph로 프로젝트를 로드한다(`tsconfig.json`이 있으면 그대로 사용, 없으면 `**/*.ts(x)`).
분석은 두 패스로 이루어진다.

**Pass 1 — 데이터 흐름 전파 (`DataFlowAnalyzer.propagate`)**
API 응답 값이 어디로 흘러가는지 추적한다. 변수는 이름이 아니라 **TypeScript symbol**로 식별하므로
shadowing이나 다른 파일에서 import한 함수도 정확히 구분된다. 선언 순서에 영향받지 않도록 fixpoint까지 반복한다.

추적하는 값의 종류:

| kind | 의미 | 전이 |
|---|---|---|
| `envelope` | axios response, `useQuery`/`useSWR` 결과 | `.data` → body |
| `fetchResponse` | `fetch()` Response | `.json()` → body |
| `body` | 응답 body (또는 그 하위) | `.x` → path에 x 추가 |

지원하는 흐름:

- 변수 할당, `await`, 괄호/`!`/`as`, `??`/`||`/`&&`/삼항
- 구조분해 `const { name } = await getUser(id)` (구조분해 자체가 필드 접근으로 기록됨)
- **Wrapper 함수 자동 추론**: `getUser()`가 `axios.get(...)`의 `.data`를 반환하면, `getUser()` 호출도 같은 endpoint의 API 호출로 인식. `userApi = { getUser: ... }` 같은 client 객체, 클래스 메서드, 다른 파일에서 import한 함수 포함. `request(url)`처럼 URL을 인자로 받으면 호출부 인자로 endpoint를 결정.
- `.then(cb)`, `.then(setUser)`
- React: `useState` setter → state 변수, JSX props → 자식 컴포넌트 파라미터(구조분해/`props.x`), `useQuery({ queryFn })`
- 배열: `.map/.forEach/.filter/.find/...` 콜백 파라미터, `for...of`
- 프로젝트 내 함수에 인자로 넘기면 파라미터로 추적, 추적 불가한 함수를 거치면 `derived`

**Pass 2 — 기록**
각 파일에서 File/Function/API Call/Property Access를 수집한다. Property access는 멤버 체인의 가장 바깥
노드에서 한 번만 기록하고(`user.profile.email` → `["profile","email"]`), `user.name.toUpperCase()`처럼
메서드 호출인 마지막 segment는 제외한다.

**API Call 인식 (MVP)**
- `axios.get/post/put/delete/patch`, `axios.create()`로 만든 인스턴스(다른 모듈에서 import해도 인식)
- `fetch(url, { method })` (기본 GET)
- Wrapper 함수 (위 참조)
- `apilens.config.json`의 `apiClientMap` (추론이 불가능한 client용 명시적 매핑, 추론보다 우선)

URL은 정적으로 해석 가능한 경우만 패턴화한다: 문자열, 템플릿 리터럴(`` `/users/${id}` ``), 문자열 연결(`"/users/" + id`)은
`/users/{param}`이 되고, 완전히 동적인 URL은 `null`로 둔다(추측하지 않음).

## 5. Java API 분석 방법 (Phase 2)

- 독립 Java 모듈이 JavaParser + JavaSymbolSolver로 소스를 파싱한다.
- `@GetMapping/@PostMapping/@PutMapping/@DeleteMapping/@PatchMapping/@RequestMapping` 메서드 → `EndpointInfo`.
  클래스 레벨 `@RequestMapping` prefix를 합친다.
- `@PathVariable/@RequestParam/@RequestHeader/@RequestBody` → request 정보, 반환 타입(`ResponseEntity<T>`, `List<T>` unwrap) → response DTO.
- DTO 필드는 상속 체인을 SymbolSolver로 해석해 flatten. `record`, Lombok(`@Data`, `@Getter`)은 필드 기준. `@JsonProperty` 이름 반영, `@Nullable`/`Optional` → nullable.
- `BackendManifest` JSON을 stdout으로 출력.

## 6. API ↔ TypeScript 연결 방법 (Phase 3)

- Backend path도 Frontend와 같은 `normalizePath`로 정규화(`{id}`, `:id` → `{param}`)한 뒤 `METHOD + pattern`으로 정확 매칭.
- Frontend에 `baseURL`/prefix(`/api`)가 붙는 경우를 위해 config에 prefix 설정을 둔다.
- 정확 매칭 실패 시 segment 유사도 후보는 리포트에만 표시하고 자동 연결하지 않는다.

## 7. Index schema (SQLite)

`node:sqlite`(Node 22.13+ 내장)를 사용해 native 모듈 빌드 없이 CI에서 동작한다.

```sql
index_meta(key, value)                         -- schemaVersion, language, rootDir, generatedAt
files(id, path, imports_json, exports_json)
functions(id, name, file_id, params_json, return_type, calls_json, line, column, component)
api_calls(id, endpoint_pattern, method, callee_expression, resolution, caller_function_id,
          file_id, line, column, arguments_json, return_var_type, code)
property_accesses(id, api_call_id, object, path_json, flow, file_id, line, column,
                  containing_function_id, containing_component, code)

INDEX api_calls(endpoint_pattern, method)       -- 변경된 endpoint → 호출부
INDEX property_accesses(api_call_id)            -- 호출부 → 필드 접근
```

조회 경로: `changed endpoint → api_calls → property_accesses → file:line + code`.
ID는 위치 기반(`call:<file>:<line>:<col>`)이라 같은 코드는 재인덱싱해도 같은 ID를 갖는다.

## 8. API change detection (Phase 4)

두 시점의 `BackendManifest`(git base/head 각각에서 Java extractor 실행)를 `METHOD + normalized path` 기준으로 비교한다.

- Endpoint: ADDED / REMOVED / CHANGED
- Request: parameter added / removed / type changed / required↔optional
- Response: field added / removed / type changed / nullable changed / array↔object

DTO는 재귀적으로 비교해 변경을 **response body 기준 path**(`["profile","email"]`)로 표현한다. Frontend index의 path와 같은 좌표계다.

## 9. Static impact analysis (Phase 5)

변경된 endpoint마다:

1. `findApiCallsByEndpoint(method, pattern)` → 호출부
2. `findPropertyAccessesForApiCall(id)` → 필드 접근
3. 변경 path와 접근 path 비교 (`"[]"` segment는 배열 원소로 정렬)

| 조건 | 판정 |
|---|---|
| 제거/타입 변경된 필드의 path와 접근 path가 일치, `flow = direct` | DEFINITE |
| 일치하지만 nullable 변경 등 runtime 영향이 조건부 | LIKELY |
| `flow = derived`이고 필드명이 일치 | POSSIBLE |
| 접근 path가 변경과 무관 | UNRELATED |

모든 finding에는 endpoint → caller function → file:line → code가 남는다.

## 10. AI verification interface (Phase 6)

`packages/core/src/ai/types.ts`

```ts
interface AiProvider {
  readonly name: string;
  verify(input: AiVerificationInput): Promise<AiVerificationResult>;
}
```

- 입력: API 변경 요약, 변경 전/후 DTO, 관련 코드 snippet, 정적 분석 finding. **Repository 전체는 보내지 않는다.**
- 출력: `PASS | WARNING | FAIL | UNKNOWN`, confidence, reason, evidence(file/line/code).
- evidence가 없거나 입력에 없는 위치를 인용하는 응답은 `UNKNOWN`으로 강등한다.
- DEFINITE finding은 AI가 뒤집을 수 없다. AI는 POSSIBLE/LIKELY 해석과 설명 생성에만 쓴다.
- Provider(Anthropic, OpenAI, Local LLM)는 이 인터페이스만 구현한다.

## 11. CI/CD (Phase 7)

```text
git push → CI → apilens diff --base <base> --head HEAD
         → 변경 endpoint → frontend index 조회 → static analysis → (optional) AI
         → report (텍스트/Markdown/JSON) → exit code: PASS 0 / WARNING 0 또는 설정 / FAIL 1
```

- Frontend index는 frontend CI에서 `apilens index`로 생성해 artifact로 올리고, backend CI에서 내려받아 사용한다.
- AI 검증은 API key가 있을 때만 동작하며, 없으면 정적 분석 결과만으로 판정한다.
