# Arbor — CLAUDE.md

> **이 파일은 모든 AI 에이전트와 팀원이 세션 시작 시 반드시 읽는 단일 진실의 원천(Single Source of Truth)입니다.**
> Arbor는 **Compound Engineering** 방법론을 따릅니다.

---

## 프로젝트 개요

**Arbor**는 Claude Code용 MCP 서버로, 코드베이스를 의미적 트리 그래프로 인코딩하고 작업 교훈을 축적하는 시스템이다.

**한 줄 설명**: `"A tree that remembers your codebase"`

**핵심 원칙**:

- MCP 서버는 바보(dumb data layer). 지능은 대화 컨텍스트의 Claude Code가 담당.
- 별도 LLM API 호출 없음. FindBestParent 같은 의미적 판단은 Claude Code가 수행.
- 모든 작업 단위가 다음 작업을 더 쉽게 만들어야 한다.

**현재 상태**: Phase 0 완료 (PR #1 머지됨). Phase 1 구현 진행 중 (`feature/mcp-write-tools` 브랜치).

---

## 기술 스택 (확정)

| 구성요소      | 선택                         | 이유                     | 설치 상태       |
| ------------- | ---------------------------- | ------------------------ | --------------- |
| 런타임        | Node.js 22+                  | 사용자 풀 넓힘           | ✅ 설치됨       |
| 패키지 매니저 | pnpm                         | 빠름, 디스크 효율적      | ✅ 설치됨       |
| 언어          | TypeScript 5.x (ESM, strict) | 타입 안전성              | ✅ 설치됨       |
| 린터          | oxlint                       | Rust 기반, 빠름          | ✅ 설치됨       |
| 포매터        | oxfmt                        | Rust 기반, Prettier 호환 | ✅ 설치됨       |
| 테스트        | vitest + V8 coverage         | thresholds: 70/70/70/55  | ✅ 설치됨       |
| DB            | better-sqlite3 + FTS5        | 동기식, 빠름             | ✅ 설치됨       |
| 스키마 검증   | zod                          | 런타임 데이터 검증       | ✅ 설치됨       |
| MCP SDK       | @modelcontextprotocol/sdk    | Claude Code 연동         | ⬜ Phase 1 설치 |
| Git 조작      | simple-git                   | diff 파싱                | ⬜ Phase 5 설치 |
| AST           | tree-sitter                  | 다중 언어 지원           | ⬜ Phase 4 설치 |
| 라이선스      | MIT                          | RPG-Encoder도 MIT        | ✅ 적용됨       |

---

## 핵심 설계 결정 (변경하지 말 것)

| 결정                     | 선택                                           | 이유                                                  |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| 교훈 저장                | nodes 테이블에 통합                            | 별도 insights 테이블 없음                             |
| 트리 구조                | 3단계 계층                                     | functional_area/category/subcategory                  |
| 엣지 구조                | Triple-View                                    | Growth(트리) + Root(의존성) + Knowledge(교훈↔코드)    |
| level 의미               | branch=추상(auto-prune), leaf=실체(persistent) | leaf→leaf parent_id 허용. file→class→method 자연 표현 |
| parent_id vs growth edge | parent_id 정규, growth edge 트랜잭션 파생      | 트리 연산 최적, 단일 진실 원천                        |
| 새 노드 배치             | 미배치 + Claude Code graft                     | 서버는 바보, FindBestParent는 Claude Code가 수행      |
| 변경 감지                | mtime 탐지 + git diff 분석                     | mtime으로 빠르게, git diff로 정확하게                 |
| Stale 추적               | metadata에 `{ stale: true }`                   | 수정된 노드 무조건 stale                              |
| Rename 처리              | 삭제 + 추가                                    | 단순함 우선, feature/Edge 유실 허용                   |
| Scan 모드                | --merge / --sync / --force                     | 기존 그래프 있을 때 모드 필수                         |

---

## 아키텍처

### 데이터 흐름

```
Claude Code (지능)
  ├─ Read tool로 코드 읽기
  ├─ 의미 분석 (Claude 자체 지능)
  │
  ├─ [쓰기] arbor_seed / arbor_graft / arbor_uproot → SQLite
  ├─ [읽기] arbor_search / arbor_fetch / arbor_explore ← SQLite
  └─ [지식] arbor_plan / arbor_compound / arbor_review ↔ SQLite + docs/
                                                          │
                                                 .arbor/graph.db
```

### 트리 구조 (RPG-Encoder 기반)

```
Root
├── Security/                        (Branch - functional_area)
│   └── Authentication/              (Branch - category)
│       └── TokenValidation/         (Branch - subcategory)
│           ├── auth-service.ts      (Leaf - file)
│           │   ├── AuthService      (Leaf - class)
│           │   │   ├── validate()   (Leaf - method)
│           │   │   └── refresh()    (Leaf - method)
│           │   └── helper()         (Leaf - function)
│           ├── "JWT 만료 함정"       (Leaf - pitfall)
│           └── "OAuth 패턴"         (Leaf - pattern)
└── API/
    └── UserController/
        └── CRUD/
            ├── user-controller.ts   (Leaf - file)
            │   └── createUser()     (Leaf - function)
            └── "N+1 해결법"          (Leaf - solution)
```

### 엣지 3종류

- **Growth Edge** (category: "growth") — 트리 계층. parent_id에서 파생, 트랜잭션으로 동기화.
- **Root Edge** (category: "root") — 의존성 (imports/invokes/inherits). 영향 분석용.
- **Knowledge Edge** (category: "knowledge") — 교훈↔코드 연결. edgeType: "documents".

### parent_id 트랜잭션 규칙

seed/graft/uproot에서 parent_id 변경 시 반드시 같은 트랜잭션에서 growth edge 동기화:

```
BEGIN TRANSACTION
  1. nodes.parent_id = 새 부모
  2. edges에서 기존 growth edge 삭제
  3. edges에 새 growth edge 삽입 (category='growth', edgeType='contains')
COMMIT
```

---

## MCP 도구 9개

### 쓰기 도구 (Phase 1 — 구현 중)

| 도구           | 동작                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| `arbor_seed`   | Leaf Node UPSERT. seed 시 `stale`/`unplaced` 자동 제거. parent_id 변경 시 growth edge 동기화. |
| `arbor_graft`  | Branch Node + Edge 생성. parentId로 growth edge 자동 파생. 대상 노드의 `unplaced` 제거.       |
| `arbor_uproot` | 삭제 + 고아 Branch 자동 정리 (branch만 prune, leaf는 보존).                                   |

### 읽기 도구 (Phase 2)

| 도구            | 동작                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `arbor_search`  | FTS5 검색 + mtime stale 경고 포함.                                          |
| `arbor_fetch`   | 노드 상세 + 자식 + 의존성 + stale 경고. `filter: "unplaced"\|"stale"` 지원. |
| `arbor_explore` | BFS 순회 + stale 경고.                                                      |

### 지식 도구 (Phase 3)

| 도구             | 동작                                                 |
| ---------------- | ---------------------------------------------------- |
| `arbor_plan`     | FTS5로 코드+교훈 검색 + CLAUDE.md 파싱.              |
| `arbor_compound` | 교훈을 Leaf Node로 저장 + docs/solutions/ 이중 저장. |
| `arbor_review`   | Root Edge 영향 분석 + Knowledge Edge 교훈 수집.      |

---

## 디렉토리 구조

> ✅ = 존재함, ⬜ = 미구현 (해당 Phase에서 생성 예정)

```
Arbor/
├── CLAUDE.md                          # ✅ 에이전트 소스 오브 트루스 (이 파일)
├── .mcp.json                          # ⬜ MCP 서버 등록 (Phase 1)
├── package.json                       # ✅
├── tsconfig.json                      # ✅
├── oxlintrc.json                      # ✅
├── .oxfmt.json                        # ✅
├── vitest.config.ts                   # ✅
├── .github/workflows/ci.yml          # ✅ CI 파이프라인
│
├── src/
│   ├── index.ts                       # ✅ CLI 엔트리포인트 (init 동작, serve/status/update는 스텁)
│   ├── config.ts                      # ✅ .arbor/config.json 관리
│   ├── server.ts                      # ⬜ MCP 서버 + 도구 등록 (Phase 1)
│   │
│   ├── tools/                         # ⬜ MCP 도구 구현 (Phase 1~3)
│   │   ├── seed.ts, graft.ts, uproot.ts       # Phase 1
│   │   ├── search.ts, fetch.ts, explore.ts    # Phase 2
│   │   └── plan.ts, compound.ts, review.ts    # Phase 3
│   │
│   ├── graph/
│   │   ├── models.ts                  # ✅ Zod 스키마 (Node, Edge, 타입 정의)
│   │   ├── traversal.ts              # ⬜ BFS/DFS (Phase 2)
│   │   └── pruner.ts                 # ⬜ 고아 Branch 정리 (Phase 1)
│   │
│   ├── analyzers/                     # ⬜ Phase 4
│   │   ├── base.ts, typescript-analyzer.ts, python-analyzer.ts
│   │   ├── dependency-extractor.ts
│   │   ├── scanner.ts                 # init --scan 엔진
│   │   └── trie.ts                    # Prefix Tree (LCA)
│   │
│   ├── knowledge/                     # ⬜ Phase 3
│   │   └── solutions.ts, patterns.ts, writer.ts
│   │
│   ├── storage/
│   │   ├── sqlite-store.ts           # ✅ CRUD 오퍼레이션
│   │   ├── migrations.ts             # ✅ SQLite 스키마 + FTS5
│   │   └── cache.ts                  # ⬜ Phase 2
│   │
│   └── git/                           # ⬜ Phase 5
│       └── diff-parser.ts, hooks.ts
│
├── tests/
│   └── setup.test.ts                 # ✅ 플레이스홀더 테스트
│
├── docs/
│   ├── plans/                         # ✅ Phase 0~6 계획 문서 (7개 파일)
│   ├── brainstorms/                   # ✅ 빈 디렉토리 (.gitkeep)
│   └── solutions/                     # ✅ 빈 디렉토리 (.gitkeep)
│
└── .arbor/                            # ✅ gitignored, `arbor init`으로 생성
    ├── graph.db                       # ✅ SQLite (nodes, edges, nodes_fts, graph_meta)
    └── config.json                    # ✅ 프로젝트 설정
```

---

## 커맨드 레퍼런스

### 개발 커맨드

```bash
pnpm install                    # 의존성 설치
pnpm build                      # TypeScript 빌드 → dist/
pnpm test                       # vitest 실행
pnpm lint                       # oxlint 실행
pnpm fmt                        # oxfmt 포매팅
pnpm fmt:check                  # 포매팅 검사
pnpm dev                        # 빌드 → DB 리셋 → tsx watch
pnpm dev:continue               # 빌드 → tsx watch (DB 유지)
pnpm ci:test                    # 전체 CI 파이프라인 (install → build → lint → fmt → test)
```

### CLI 커맨드

```bash
npx arbor init                  # ✅ .arbor/graph.db 생성 (빈 테이블)
npx arbor init --reset          # ✅ 기존 DB 삭제 후 재생성
npx arbor init --scan           # ⬜ 초기 스캔 포함 (Phase 4)
npx arbor serve                 # ⬜ MCP 서버 실행 (Phase 1)
npx arbor status                # ⬜ 그래프 상태 요약 (Phase 1)
npx arbor update                # ⬜ git diff 기반 점진적 업데이트 (Phase 5)
npx arbor hooks install         # ⬜ post-commit hook 설치 (Phase 5)
```

---

## 구현 순서 (Phase 0~6)

**반드시 이 순서대로 구현.** 각 Phase는 이전 Phase에 의존.

| Phase | 내용                                           | 문서                                              | 검증                                       | 상태       |
| ----- | ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | ---------- |
| **0** | 환경 설정, Zod 모델, SQLite, CLI 뼈대          | `docs/plans/phase-0-project-init.md`              | `pnpm build && npx arbor init`             | ✅ 완료    |
| **1** | MCP 서버 + 쓰기 도구 (seed/graft/uproot)       | `docs/plans/phase-1-mcp-server-write-tools.md`    | Claude Code에서 arbor_seed 호출            | 🔄 진행 중 |
| **2** | 읽기 도구 (search/fetch/explore) + mtime stale | `docs/plans/phase-2-read-tools.md`                | seed → search → fetch → explore 파이프라인 | ⬜ 대기    |
| **3** | 지식 레이어 (plan/compound/review)             | `docs/plans/phase-3-knowledge-layer.md`           | arbor_compound → 노드 + docs/ 파일 생성    | ⬜ 대기    |
| **4** | AST 분석기 + 일괄 스캔 (merge/sync/force)      | `docs/plans/phase-4-ast-analyzers.md`             | `arbor init --scan` 동작                   | ⬜ 대기    |
| **5** | Git 연동 + 점진적 업데이트 + stale 관리        | `docs/plans/phase-5-git-integration.md`           | 커밋 diff → 변경 함수 목록 반환            | ⬜ 대기    |
| **6** | 통합 테스트 + npm 배포 + CLAUDE.md 워크플로우  | `docs/plans/phase-6-integration-stabilization.md` | Compound 루프 1사이클 완주                 | ⬜ 대기    |

---

## DB 스키마 (Phase 0에서 구현됨)

```sql
-- 노드 테이블
nodes (id TEXT PK, name TEXT, level TEXT, nodeType TEXT, filePath TEXT,
       parent_id TEXT FK, metadata TEXT(JSON), created_at TEXT, updated_at TEXT)

-- 엣지 테이블
edges (id TEXT PK, source_id TEXT FK, target_id TEXT FK,
       category TEXT, edgeType TEXT, metadata TEXT(JSON),
       created_at TEXT, updated_at TEXT)

-- FTS5 전문 검색
nodes_fts (name, nodeType, filePath, metadata) -- content=nodes

-- 메타데이터
graph_meta (key TEXT PK, value TEXT)  -- schema_version, project_root
```

---

## Compound Engineering 4단계 루프

모든 기능 개발은 이 루프를 따릅니다. Plan과 Review에 80%, Work와 Compound에 20%의 시간을 배분합니다.

### 1. Plan (계획)

- [ ] 요구사항 파악 (무엇을, 왜, 제약조건)
- [ ] 코드베이스에서 유사 패턴 조사
- [ ] 외부 문서/모범 사례 조사
- [ ] 영향받는 파일과 접근 방식 설계
- [ ] 계획의 완전성 검증

### 2. Work (실행)

- [ ] 격리된 환경 설정 (git branch/worktree)
- [ ] 계획을 단계별로 실행
- [ ] 검증 실행 (테스트, 린트, 타입 체크)
- [ ] 진행 상황 추적 및 이슈 대응

### 3. Review (검토)

- [ ] 전문 리뷰 에이전트로 결과물 검토
- [ ] 발견 사항을 P1/P2/P3로 분류
- [ ] 에이전트 지원으로 발견 사항 해결
- [ ] 수정 사항의 정확성 검증

### 4. Compound (축적)

- [ ] 잘 된 점과 안 된 점 기록
- [ ] YAML 프론트매터로 인사이트를 검색 가능하게 태그
- [ ] 이 CLAUDE.md에 새로운 패턴/교훈 업데이트
- [ ] 시스템이 다음에 자동으로 잡을 수 있는지 검증

---

## 코딩 컨벤션

### 파일/디렉토리 네이밍

- **kebab-case** 사용: `user-profile.ts`, `auth-service/`
- 컴포넌트 파일만 **PascalCase** 허용: `UserProfile.tsx`

### Git 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식:

```
<type>(<scope>): <description>

[optional body]
```

**type**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`

### 브랜치 네이밍

```
<type>/<short-description>
```

예시: `feat/user-auth`, `fix/login-race-condition`, `docs/api-reference`

---

## Common Pitfalls

> 구현 중 발견된 코딩 함정과 해결책을 여기에 축적합니다.
> 형식: `- **문제**: 설명 → **해결**: 설명`

- **문제**: WSL 환경에서 한국어가 포함된 경로(`/mnt/c/Users/박/...`)로 `Edit` 도구 사용 시 간헐적 `ENOENT` 에러 → **해결**: `Read` → `Write` 전체 덮어쓰기 또는 `Bash` sed -i 사용
- **문제**: 포매터 패키지명 혼동. `@oxc/oxfmt`는 존재하지 않음 → **해결**: 올바른 패키지명은 `oxfmt` (npm)
- **문제**: pnpm에서 better-sqlite3, esbuild native 빌드 실패 → **해결**: `pnpm.onlyBuiltDependencies`에 명시적으로 추가

---

## 리뷰 분류 기준 (P1/P2/P3)

| 등급   | 의미                   | 예시                                                  | 조치                          |
| ------ | ---------------------- | ----------------------------------------------------- | ----------------------------- |
| **P1** | CRITICAL — 반드시 수정 | 보안 취약점, 데이터 손실, 트랜잭션 누락               | 머지 전 즉시 수정             |
| **P2** | IMPORTANT — 수정 권장  | N+1 쿼리, 비즈니스 로직 위치 오류, 누락된 에러 핸들링 | 이번 PR 또는 후속 PR에서 수정 |
| **P3** | MINOR — 개선 가능      | 미사용 변수, 가드 절 권장, 네이밍 개선                | 시간 여유 시 수정             |

---

## 문서 템플릿

### Solution 문서 (`docs/solutions/`)

```markdown
---
title: "해결한 문제의 제목"
date: YYYY-MM-DD
tags: [카테고리, 도메인, 문제-유형]
category: solutions
severity: P1 | P2 | P3
status: resolved
---

## 문제

## 원인

## 해결

## 예방

## 관련 문서
```

### Plan 문서 (`docs/plans/`)

```markdown
---
title: "기능/작업 제목"
date: YYYY-MM-DD
tags: [관련-도메인]
category: plans
status: draft | approved | in-progress | completed
---

## 목표

## 배경

## 접근 방식

## 영향받는 파일

## 엣지 케이스

## 검증 방법
```

### Brainstorm 문서 (`docs/brainstorms/`)

```markdown
---
title: "주제"
date: YYYY-MM-DD
tags: [관련-키워드]
category: brainstorms
status: exploring | decided
---

## 질문

## 선택지

## 결정
```

---

## Todo 파일 네이밍 규칙

`todos/` 디렉토리: `NNN-STATUS-PRIORITY-description.md`

- **NNN**: 3자리 순번 (001, 002, ...)
- **STATUS**: `ready` | `pending` | `in-progress` | `done` | `blocked`
- **PRIORITY**: `p1` | `p2` | `p3`

예시: `001-ready-p1-setup-phase-0.md`

---

## 50/50 규칙

- **50% 기능 개발**: 직접적인 제품 가치 전달
- **50% 시스템 개선**: 리뷰 에이전트 작성, 패턴 문서화, 테스트 생성기 구축 등

시스템 개선은 낭비가 아니라 **복리 투자**입니다.

---

## 참조 자료

- **RPG-Encoder 논문 분석**: `.claude/rpg-encoder-analysis.md`
- **Compound Engineering 분석**: `.claude/compound-engineering-report.md`
- **Phase 계획 문서**: `docs/plans/phase-{0..6}-*.md`

---

_이 파일은 프로젝트와 함께 진화합니다. 새로운 패턴, 실수, 교훈을 발견하면 즉시 업데이트하세요._
