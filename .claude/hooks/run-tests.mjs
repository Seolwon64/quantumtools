// Stop 훅: 턴이 끝날 때 문법 전수 검사 → 테스트 전체 순으로 돌린다.
// 이 리포에서 실제로 위험한 건 문법 오류가 아니라 조용히 깨지는 수치 로직이다.
// 실패하면 exit 2 — 출력이 모델에게 되돌아가고 턴이 재개된다.
//
// 문법 검사를 여기에 둔 이유(실측 근거):
//   PostToolUse 의 syntax-check.mjs 는 matcher 가 Write|Edit 이라 도구 이름에 걸린다.
//   Bash 로 `printf ... >> js/tokens.js` 를 하면 같은 파일을 깨뜨려도 그 훅을 타지
//   않는다. 실제로 tokens.js 를 파싱 불가능한 상태로 만들고도 훅이 뜨지 않았고,
//   테스트는 253개 전부 통과했다 — 테스트가 tokens.js 를 임포트하지 않기 때문이다.
//   즉 Bash 경로에는 방어선이 하나도 없었다. Stop 은 도구와 무관하게 턴 끝에 도므로
//   어떤 경로로 깨뜨렸든 여기서 걸린다.
//   syntax-check.mjs 의 matcher 를 Bash 로 넓히는 방식은 쓰지 않는다 — Bash 이벤트에는
//   tool_input.file_path 가 없어 검사할 파일을 특정할 수 없고, 넓히면 아무것도 검사하지
//   않으면서 막힌 것처럼 보인다(지금보다 나쁘다).
//
// 순서가 문법 → 테스트인 이유: 문법이 깨진 채로 테스트를 돌리면 실패 원인이 섞인다.
//
// 세 가지를 의도적으로 피한다:
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
//
// 3. 문법 검사에도 같은 원칙을 적용한다. 검사 대상 파일을 하나도 못 찾으면 통과가
//    아니라 실패다. 경로가 틀렸을 때 조용히 0개를 검사하고 넘어가는 것이 이 검사의
//    치명적 실패 모드다.
//
// 의존: package.json 의 "type": "module". 이게 없으면 node --check 가 .js 를
// CommonJS 로 읽어 ESM 문법 오류를 exit 0 으로 통과시킨다(syntax-check.mjs 와 동일).
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot =
  process.env.CLAUDE_PROJECT_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 문법 검사 대상. 배포되는 코드(js/)가 본체이고 나머지는 덤이다.
// test/ 는 node --test 가 어차피 파싱하지만, 여기서 걸리면 원인이 더 분명하다.
const CHECK_DIRS = ["js", "test", ".claude/hooks", ".claude/skills", "scripts"];
const CHECK_EXT = /\.(?:mjs|cjs|js)$/;
const CONCURRENCY = 8; // 윈도우는 프로세스 생성이 비싸다 — 순차로 돌리면 턴마다 몇 초 붙는다

function collectFiles() {
  const files = [];
  for (const dir of CHECK_DIRS) {
    const abs = resolve(projectRoot, dir);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true, recursive: true });
    } catch {
      continue; // 없는 디렉터리는 건너뛴다 — 총합 0 검사가 오탐을 잡아준다
    }
    for (const e of entries) {
      if (!e.isFile() || !CHECK_EXT.test(e.name)) continue;
      files.push(join(e.parentPath ?? e.path ?? abs, e.name));
    }
  }
  return files;
}

function checkOne(file) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      ["--check", file],
      { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        done(err ? { file, message: String(stderr).trim() } : null);
      },
    );
  });
}

async function checkSyntax() {
  const files = collectFiles();
  if (files.length === 0) {
    fail(
      `문법 검사 대상을 하나도 찾지 못했다. ${projectRoot} 아래 ${CHECK_DIRS.join(", ")} 가 사라졌거나 경로가 틀렸다.`,
    );
  }

  const broken = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = await Promise.all(files.slice(i, i + CONCURRENCY).map(checkOne));
    for (const r of batch) if (r) broken.push(r);
  }

  if (broken.length > 0) {
    const detail = broken
      .map((b) => `--- ${relative(projectRoot, b.file)}\n${b.message}`)
      .join("\n\n");
    fail(
      `문법 오류 ${broken.length}건 (검사한 파일 ${files.length}개).\n` +
        `Bash 리다이렉션으로 편집했다면 PostToolUse 훅을 타지 않는다 — 여기서 잡힌 것이다.\n\n${detail}`,
    );
  }
  return files.length;
}

function runTests(checkedCount) {
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
      // 통과하면 조용히. (문법 ${checkedCount}개 · 테스트 ${total}개)
    },
  );
}

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
    /* 입력을 못 읽어도 검사는 돌린다 */
  }

  // 이 훅이 이미 한 번 턴을 되돌린 상태면 다시 돌리지 않는다.
  // 없으면 실패 → 재호출 → 다시 Stop 으로 무한 루프가 된다.
  if (input?.stop_hook_active) process.exit(0);

  checkSyntax().then(runTests, (e) => {
    // 검사 자체가 터진 경우. 조용히 통과시키지 않는다 —
    // 이 훅의 존재 이유가 "검사하지 않았는데 통과처럼 보이는 것"을 막는 데 있다.
    fail(`문법 검사가 실행되지 못했다: ${e?.stack ?? e}`);
  });
});

function fail(message) {
  process.stderr.write(`${message}\n고치기 전에는 턴을 끝내지 마라.\n`);
  process.exit(2);
}
