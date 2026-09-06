// InstructionsLoaded 훅. CLAUDE.md·.claude/rules/*.md 가 컨텍스트에 로드될 때마다
// 입력 JSON을 그대로 한 줄씩 기록한다. 판단하지 않고 기록만 한다 — 이 훅의 목적은
// 룰이 언제 로드되는지를 추측이 아니라 로그로 확인하는 것이다.
//
// 왜 전체 JSON을 그대로 남기는가: 이 이벤트의 필드 이름(파일 경로가 무엇으로 오는지,
// 로드 사유 필드가 무엇인지)을 확정하지 않았다. 필드를 골라 담으면 이름을 잘못 짚었을 때
// 조용히 빈 로그가 남는다. 원문을 통째로 남기면 첫 실행에서 스키마가 드러난다.
// 스키마를 확인한 뒤 필요하면 요약 형태로 줄여도 된다.
//
// 문서상 이 이벤트는 종료 코드를 무시한다. 그래도 항상 0으로 끝낸다 —
// 로깅 훅이 세션에 영향을 주는 경로를 아예 만들지 않는다.
//
// 의존: package.json 의 "type": "module". node --check 가 이 파일을 ESM 으로 읽는
// 근거이며, 빠지면 syntax-check.mjs 와 같은 이유로 조용히 어긋난다.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// cwd 에 의존하지 않는다: <repo>/.claude/hooks/ 에서 두 단계 위가 리포 루트다.
// $CLAUDE_PROJECT_DIR 을 쓰지 않는 이유는 worktree 로 들어가면 그 값과 실제 작업
// 디렉터리가 갈라지기 때문이다. 훅 파일 자신의 위치가 가장 흔들리지 않는 기준이다.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const logDir = resolve(repoRoot, ".claude", "logs");
const logPath = resolve(logDir, "instructions-loaded.jsonl");
const MAX_BYTES = 1_000_000;

function readStdin() {
  // 훅 입력은 stdin 으로 온다. 동기로 통째 읽는다 — 이 훅은 몇 밀리초 안에 끝나야 하고,
  // 비동기로 만들면 프로세스가 먼저 끝나 기록이 유실될 수 있다.
  try {
    return readFileSync(0, "utf8"); // fd 0 = stdin
  } catch {
    return "";
  }
}

function rotateIfLarge() {
  // 이 이벤트는 세션 시작 + 지연 로드마다 뛴다. 상한을 두지 않으면 무한히 자란다.
  try {
    if (statSync(logPath).size > MAX_BYTES) {
      renameSync(logPath, `${logPath}.1`); // 이전 회차는 하나만 남긴다
    }
  } catch { /* 파일이 아직 없다 — 정상 */ }
}

try {
  const raw = readStdin();
  mkdirSync(logDir, { recursive: true });
  rotateIfLarge();

  let record;
  try {
    // 원문을 파싱해 그대로 다시 직렬화한다. 줄바꿈이 섞여 들어와도 JSONL 한 줄이 깨지지 않는다.
    record = { at: new Date().toISOString(), ...JSON.parse(raw) };
  } catch {
    // 파싱 실패도 기록한다. 조용히 버리면 "훅이 안 뛰었다"와 구분되지 않는다.
    record = { at: new Date().toISOString(), parseError: true, raw: raw.slice(0, 4000) };
  }

  appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
} catch {
  // 기록에 실패해도 세션은 그대로 간다. 로깅이 작업을 막는 일은 없어야 한다.
}

process.exit(0);
