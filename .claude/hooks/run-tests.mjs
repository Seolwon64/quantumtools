// Stop 훅: 턴이 끝날 때 테스트 전체를 돌린다.
// 이 리포에서 실제로 위험한 건 문법 오류가 아니라 조용히 깨지는 수치 로직이다.
// 실패하면 exit 2 — 출력이 모델에게 되돌아가고 턴이 재개된다.
//
// 두 가지를 의도적으로 피한다:
//
// 1. `node --test test/` 를 쓰지 않는다. Node v26 이 test/ 를 로드할 모듈로 취급해
//    MODULE_NOT_FOUND 를 내면서 그걸 "실패한 테스트 1개"로 보고한다 — 아무것도 안
//    돌았는데 테스트가 깨진 것처럼 보인다. 인자 없는 `node --test` 는 셸 글로브에도
//    의존하지 않는다.
//
// 2. 종료 코드만 믿지 않는다. 이 훅의 유일한 치명적 실패 모드는 탐색 실패가 성공으로
//    보고되는 것이다 — 테스트 파일을 하나도 못 찾으면 Node 는 `# tests 0` 을 찍고
//    **exit 0** 으로 끝낸다(빈 디렉터리에서 실측). 그래서 TAP 리포터로 돌려
//    `# tests N` 을 직접 읽고 N 이 0 이면 실패로 처리한다.
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot =
  process.env.CLAUDE_PROJECT_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    /* 입력을 못 읽어도 테스트는 돌린다 */
  }

  // 이 훅이 이미 한 번 턴을 되돌린 상태면 다시 돌리지 않는다.
  // 없으면 실패 → 재호출 → 다시 Stop 으로 무한 루프가 된다.
  if (input?.stop_hook_active) process.exit(0);

  execFile(
    process.execPath,
    ["--test", "--test-reporter=tap"],
    { cwd: projectRoot, maxBuffer: 32 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`;
      const total = Number(out.match(/^# tests (\d+)$/m)?.[1] ?? NaN);

      if (!Number.isFinite(total)) {
        return fail(
          `테스트 요약(# tests)을 찾지 못했다 — 러너가 실행되지 않았다.\n\n${out}`,
        );
      }
      if (total === 0) {
        return fail(
          `테스트를 하나도 찾지 못했다 (# tests 0). ${projectRoot} 아래 test/*.test.mjs 가 사라졌거나 cwd 가 틀렸다.\n\n${out}`,
        );
      }
      if (err) return fail(`테스트 ${total}개 중 실패가 있다.\n\n${out}`);
      // 통과하면 조용히
    },
  );
});

function fail(message) {
  process.stderr.write(`${message}\n고치기 전에는 턴을 끝내지 마라.\n`);
  process.exit(2);
}
