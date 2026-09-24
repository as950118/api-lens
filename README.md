# ApiLens

Backend API가 바뀌었을 때, 기존 Frontend 코드 중 **무엇을 고쳐야 하는지** 배포 전에 알려주는 CLI 도구.

Frontend를 미리 인덱싱해두고, API가 바뀌면 그 API와 연결된 코드만 찾아 정적 분석한다.
AI는 정적으로 확정할 수 없는 부분을 검증하는 데만 쓴다. 설계는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참고.

## 요구사항

- Node.js 22.13+ (내장 `node:sqlite` 사용)
- Java backend 분석 시 JDK 17+

## 설치 & 빌드

```bash
npm install
npm run build:jar   # Java extractor JAR (Gradle)
npm run build
npm test            # TS 테스트 (JAR가 있으면 Java 연동 테스트 포함)
npm run test:jvm    # Java extractor 단위 테스트
```

## 사용법

모든 명령은 같은 index DB(`-i, --index`, 기본 `.apilens/index.db`)를 공유한다.

### 1. Frontend 인덱싱

```bash
node packages/cli/dist/bin.js index ./frontend
```

```text
ApiLens index written to /path/.apilens/index.db
  Files:              9
  Functions:          22
  API calls:          15 (15 with resolved endpoint)
  Property accesses:  16
  Updated files:      9
```

인식하는 패턴 예:

```ts
axios.get(`/users/${id}`)                  // GET /users/{param}
api.put("/users/" + id, body)              // axios.create() 인스턴스
fetch(`/users/${id}`, { method: "DELETE" })

const user = await getUser(id)             // wrapper 함수 자동 추론
const { name } = await getUser(id)         // → name
console.log(user?.profile.email)           // → profile.email
return <h1>{user.name}</h1>                // → name
<UserCard user={user} />                   // 자식 컴포넌트까지 추적
users.map((u) => u.name)                   // → [].name
transform(user).name                       // → name (derived: 확실하지 않음)
axios.get("/users", { params: { page } })  // query key: page
```

### 2. Backend API 추출 (Spring Boot)

```bash
node packages/cli/dist/bin.js extract-backend ./backend      # -o backend.json 으로 JSON도 저장
```

Endpoint(method, path, handler, path/query/header 파라미터, request body, response 타입)와 DTO의 JSON 필드
(상속, record, getter, `@JsonProperty`, `@JsonIgnore`, `@JsonNaming`, nullable, enum, `Page<T>`)를 추출한다.
backend를 빌드하지 않고 소스만 읽는다.

### 3. Contract check — frontend가 실제 API와 맞는가

```bash
node packages/cli/dist/bin.js check                                   # 전체
node packages/cli/dist/bin.js index ./frontend --changed-since origin/main --check   # 바뀐 TS 파일만: 갱신 → API 목록 → 검사
```

```text
ApiLens contract check: FAIL  (scope: 1 file)

APIs checked (1):
  ✗ GET /products/{id}  1 call site, 1 field read  1 issue

Issues: 1 error, 0 warnings, 0 info

  ERROR   src/pages/Product.tsx:5:10  FIELD_NOT_FOUND
          ProductResponse has no field `cost` (reading `cost` from GET /products/{id})
          product.cost
```

없는 endpoint, method 불일치, 없는 필드(오타 제안), 배열/객체 혼동, body 없는 응답 읽기, request body/query key 불일치를
검사한다. `--format json`, `--fail-on error|warning|never`(기본 error → exit 1).

### 4. Impact — 바꾸면 어디까지 영향이 가나 (실제 변경 없이)

```bash
apilens impact --api "GET /users/{id}"        # 호출 위치, 읽는 필드, 파일·컴포넌트
apilens impact --file src/api/user.ts         # 이 파일의 API, client 함수 호출처, import하는 파일, blast radius
apilens impact --field UserResponse.name      # 이 필드를 반환하는 모든 endpoint와 읽는 위치
apilens impact --search profile               # 통합 검색
apilens impact --summary                      # API/파일을 영향도 순으로, 안 쓰이는 endpoint
apilens graph -o .apilens/graph.html          # 전체 인터랙티브 그래프
apilens impact --file src/api/user.ts -f html -o impact.html   # 특정 질의의 그래프
apilens impact --api "GET /users/{id}" -f mermaid              # PR 코멘트용 Mermaid
```

HTML 그래프는 API → 응답 필드 → 함수/컴포넌트 → 파일의 계층 그래프다. 노드를 클릭하면 연결된 전체를 추적하고,
검색과 종류 필터, 검색 가능한 목록을 제공한다. 외부 리소스 없이 단일 파일로 동작한다.

### apilens.config.json

```json
{
  "apiClientMap": {
    "productApi.getProduct": { "method": "GET", "path": "/products/{id}" }
  },
  "linking": { "frontendBasePath": "/api", "backendBasePath": "" }
}
```

- `apiClientMap`: endpoint를 자동 추론할 수 없는 API client(예: 제네릭 `request({ method, url })` 헬퍼)의 명시적 매핑.
- `linking`: frontend HTTP client의 baseURL, backend context-path 등 prefix 차이.

## 로드맵

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | TypeScript AST 분석 + Index | ✅ |
| 2 | Java Spring API 분석 (JavaParser) | ✅ |
| 3 | Backend API ↔ Frontend 호출 연결, contract check, incremental index, 영향 범위 탐색·그래프 | ✅ |
| 4 | API 변경 감지 | |
| 5 | Static impact analysis | |
| 6 | AI verification | |
| 7 | Git diff / CI integration | |
| - | Library API / MCP server | |

`apilens analyze`, `apilens diff`, `apilens verify`는 커맨드만 등록되어 있고 아직 동작하지 않는다.

## 새 언어 추가

Core는 언어를 모른다. 새 언어는 공통 IR(`packages/core/src/ir/types.ts`)로 된 Manifest를 출력하는 extractor만 만들면 된다.

- JS/TS로 작성: `LanguageExtractor` 인터페이스 구현
- 다른 언어로 작성: `<command> <rootDir>` 실행 시 stdout에 Manifest JSON을 출력하는 실행 파일 → `SubprocessExtractor`로 연결
