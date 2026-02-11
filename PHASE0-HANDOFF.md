# Phase 0 Handoff — For Next Agent

> **이 파일 하나만 읽으면 현재 상태를 완전히 파악하고 남은 작업을 이어갈 수 있습니다.**

---

## 1. 현재 상태: Phase 0 구현 완료, PR 생성만 남음

- 브랜치: `feature/init` (base: `main`)
- 리모트에 **푸시 완료**
- 커밋 2개:
  1. `f4cf136 chore: bootstrap project foundation with tooling, models, storage, and CLI`
  2. `ddec422 chore: replace prettier with oxfmt and apply formatting`

---

## 2. 남은 작업: PR 생성

`gh pr create`로 `feature/init` → `main` PR을 만들면 됩니다.

**주의**: 이전 세션에서 `gh pr create` 실행 시 유저가 중단(reject)했음. 유저에게 "PR 만들까요?" 확인 후 진행할 것.

추천 PR 제목: `chore(phase-0): bootstrap project foundation`

PR 본문에 포함할 내용:
- 생성된 파일 목록 (아래 섹션 3 참조)
- 검증 완료 항목 (아래 섹션 4 참조)
- 유저는 **한국어**로 소통, 커밋/PR 제목은 영어 Conventional Commits

---

## 3. 생성된 파일 (Phase 0에서 만든 것)

| 파일 | 역할 |
|------|------|
| `package.json` | name: arbor-graph, ESM, bin: arbor, scripts (build/lint/fmt/test), deps: better-sqlite3+zod, devDeps: typescript+oxlint+oxfmt+vitest 등 |
| `tsconfig.json` | strict, module: NodeNext, target: ES2022, outDir: dist, rootDir: src |
| `oxlintrc.json` | no-unused-vars: warn, no-console: off, eqeqeq: error, ignorePatterns: dist/node_modules/.arbor/ |
| `vitest.config.ts` | V8 coverage thresholds: statements 70, branches 70, functions 70, lines 55 |
| `.prettierignore` | dist/, node_modules/, .arbor/, pnpm-lock.yaml (oxfmt가 .gitignore 자동 사용하지만 남겨둠) |
| `src/graph/models.ts` | Zod 스키마: NodeTypeSchema(7종), LevelSchema(branch/leaf), EdgeTypeSchema(6종), EdgeCategorySchema(3종), ArborNodeSchema, ArborEdgeSchema + 전부 type export |
| `src/config.ts` | ArborConfig interface, loadConfig(), saveConfig(), ensureArborDir() — .arbor/config.json 관리 |
| `src/storage/migrations.ts` | runMigrations(db) — nodes, nodes_fts(FTS5), edges, graph_meta 테이블 + FTS5 동기화 트리거 3개 + 인덱스 6개 |
| `src/storage/sqlite-store.ts` | ArborStore 클래스 — constructor(WAL, foreign_keys ON, runMigrations), getNode, upsertNode, deleteNode, getEdge, upsertEdge, deleteEdge, getChildren, getMeta, setMeta, close |
| `src/index.ts` | CLI entry (shebang 포함) — init(--reset), serve(stub), status(stub), update(stub), --help |

---

## 4. 검증 완료 항목 (전부 통과)

- [x] `pnpm build` — dist/index.js 생성, shebang 포함, TS 에러 없음
- [x] `pnpm lint` — 0 warnings, 0 errors (oxlint)
- [x] `pnpm fmt:check` — oxfmt 포매팅 통과
- [x] `node dist/index.js init` — .arbor/graph.db 생성 (nodes, edges, nodes_fts, graph_meta)
- [x] `node dist/index.js init` 재실행 — "이미 존재" 경고, DB 유지
- [x] `node dist/index.js init --reset` — DB 삭제 후 재생성
- [x] `graph_meta` 테이블에 schema_version=1, project_root 확인

---

## 5. 시도한 것 / 잘 된 것

### Wave 기반 병렬 구현 — 성공
4개 Wave로 나눠 subagent 병렬 실행. 총 6개 subagent 사용, 모두 성공.

### better-sqlite3 네이티브 빌드 — 해결
pnpm이 기본적으로 native build를 차단함. `package.json`에 `pnpm.onlyBuiltDependencies: ["better-sqlite3", "esbuild"]` 추가하고 clean install로 해결.

### oxfmt 전환 — 해결
CLAUDE.md에 `@oxc/oxfmt`로 적혀있었으나 npm에 해당 패키지 없음. 실제 패키지명은 **`oxfmt`**. prettier 제거하고 oxfmt로 전환 완료. CLAUDE.md도 수정됨.

---

## 6. 잘 안 된 것 / 주의점

### WSL 한국어 경로 문제 (반복 발생)
- 프로젝트 경로: `/mnt/c/Users/박/Desktop/hi/Arbor`
- **`Edit` 도구가 간헐적으로 `ENOENT` 에러 발생** (한국어 '박' 때문으로 추정)
- `Read`는 정상 동작, `Edit`만 실패
- **우회법**: `Bash`에서 `sed -i`로 편집하거나, `Read` → `Write`로 전체 파일 덮어쓰기
- 이 문제는 **매번 발생할 수 있으므로** Edit 실패 시 즉시 우회할 것

### PR 생성 시 유저 중단
- 이전 세션에서 `gh pr create` Bash 호출을 유저가 reject함
- 유저가 직접 만들고 싶거나, 내용 확인 후 진행하고 싶었을 수 있음
- **반드시 유저에게 먼저 확인 후 실행**

---

## 7. 프로젝트 핵심 컨텍스트 (필요 시 참조)

- **CLAUDE.md** (프로젝트 루트): 전체 설계 문서 — 기술 스택, 아키텍처, MCP 도구 9개, Phase 0~6 구현 순서, 코딩 컨벤션
- **HANDOFF.md** (프로젝트 루트): 아키텍처 결정 이력, 확정 SQL 스키마, P1/P2/P3 이슈 목록
- **docs/plans/phase-0-project-init.md**: Phase 0 상세 계획 (이미 구현 완료)
- 유저 선호: 한국어 소통, 영어 Conventional Commits, Compound Engineering 방법론
- 다음 단계: Phase 1 (MCP 서버 + 쓰기 도구 seed/graft/uproot)
