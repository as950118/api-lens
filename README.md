# ApiLens

Backend API가 바뀌었을 때, 기존 Frontend 코드 중 **무엇을 고쳐야 하는지** 배포 전에 알려주는 CLI 도구.

Frontend를 미리 인덱싱해두고, API가 바뀌면 그 API와 연결된 코드만 찾아 정적 분석한다.
AI는 정적으로 확정할 수 없는 부분을 검증하는 데만 쓴다. 설계는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참고.

## 요구사항

- Node.js 22.13+ (내장 `node:sqlite` 사용)
- (Phase 2부터) Java backend 분석 시 JDK 17+

## 설치 & 빌드

```bash
npm install
npm run build
npm test
```

## 사용법

### Frontend 인덱싱

```bash
node packages/cli/dist/bin.js index ./frontend
# 옵션
#   -c, --config <path>    apilens.config.json (기본: <frontendDir>/apilens.config.json)
#   -o, --out <path>       index DB 경로 (기본: .apilens/index.db)
#   -m, --manifest <path>  추출 결과를 JSON으로도 저장
```

```text
ApiLens index written to /path/.apilens/index.db
  Files:              8
  Functions:          16
  API calls:          10 (10 with resolved endpoint)
  Property accesses:  9
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
```

### apilens.config.json

Endpoint를 자동으로 추론할 수 없는 API client(예: 제네릭 `request({ method, url })` 헬퍼)는 명시적으로 매핑한다.

```json
{
  "apiClientMap": {
    "productApi.getProduct": { "method": "GET", "path": "/products/{id}" }
  }
}
```

## 로드맵

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | TypeScript AST 분석 + Index | ✅ |
| 2 | Java Spring API 분석 (JavaParser) | |
| 3 | Backend API ↔ Frontend 호출 연결 | |
| 4 | API 변경 감지 | |
| 5 | Static impact analysis | |
| 6 | AI verification | |
| 7 | Git diff / CI integration | |

`apilens analyze`, `apilens diff`, `apilens verify`는 커맨드만 등록되어 있고 아직 동작하지 않는다.

## 새 언어 추가

Core는 언어를 모른다. 새 언어는 공통 IR(`packages/core/src/ir/types.ts`)로 된 Manifest를 출력하는 extractor만 만들면 된다.

- JS/TS로 작성: `LanguageExtractor` 인터페이스 구현
- 다른 언어로 작성: `<command> <rootDir>` 실행 시 stdout에 Manifest JSON을 출력하는 실행 파일 → `SubprocessExtractor`로 연결
