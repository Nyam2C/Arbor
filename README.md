# Arbor

<p align="center">
  <img src="assets/Arbor_logo.png" alt="Arbor Logo" width="400">
</p>

> A tree that remembers your codebase — MCP server for Claude Code

## Scripts

| 명령어 | 설명 |
|---|---|
| `pnpm setup` | 초기 환경 셋업 (install + build) |
| `pnpm dev` | DB 초기화 + watch 모드 (처음부터 시작) |
| `pnpm dev:continue` | 기존 DB 유지 + watch 모드 (이어하기) |
| `pnpm build` | TypeScript 빌드 → `dist/` |
| `pnpm test` | vitest 실행 |
| `pnpm lint` | oxlint 실행 |
| `pnpm fmt` | oxfmt 포매팅 적용 |
| `pnpm fmt:check` | 포매팅 검사 (수정 없음) |
| `pnpm ci:test` | CI 파이프라인 로컬 재현 (lockfile 검증 + build + lint + fmt + test) |
