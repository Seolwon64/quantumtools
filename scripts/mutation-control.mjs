// 메모리 안 변이로 테스트의 대조군을 돌린다 — 디스크의 소스는 건드리지 않는 수동 도구.
//
// 왜: 옛 코드에서도 통과하는 테스트는 옛 코드가 대조군이 될 수 없다(예: test/codepanel.test.mjs 의
// 「편집의 종류마다 진짜 변경은 충돌 줄을 띄운다」 — 예전 판정은 렌더마다 충돌이라 무엇이든 통과시켰다).
// 그 테스트가 막으려는 실패를 직접 만들어 돌려야 테스트가 그 실패를 가리는지 안다. 소스에 스텁을 넣고 되돌리는 방식은
// 되돌리기를 잊으면 그대로 커밋된다 — 그래서 모듈 로드 훅이 대상 파일의 소스만 메모리에서 바꿔 넣는다.
//
// 쓰는 법:
//   node scripts/mutation-control.mjs --file <대상> --find "<원문>" --replace "<바꿀 글>" [--name <이름>] <테스트 파일…>
// 예(서명에서 고전 비트 수를 뺀다 → 「고전 비트 수 변경」 경우가 실패해야 한다):
//   node scripts/mutation-control.mjs --file js/export.js \
//     --find "snapshot.grid, snapshot.clbitCount)" --replace "snapshot.grid)" test/codepanel.test.mjs
//
// 종료 코드: 0 CAUGHT — 변이가 적용됐고 테스트가 하나 이상 실패했다.
//            1 SURVIVED — 변이가 적용됐는데 모두 통과했다. 테스트가 이 실패를 잡지 못한다.
//            2 FAIL — 장치가 아래 규칙에 걸렸다. 변이 결과를 믿지 않는다.
//
// 규칙
// - **변이가 적용되지 않으면 멈춘다.** 적용되지 않은 변이는 "모두 통과" 로 보여 SURVIVED 를 거짓으로 만든다.
//   · --find 가 대상 파일에 정확히 한 번 나와야 한다 — 0번이면 아무것도 안 바뀌고, 여러 번이면 어느 것을 바꿨는지 모른다.
//     줄바꿈은 대상에 맞춘다: 원문 그대로와 줄바꿈 변환형(LF↔CRLF)의 일치 수를 합쳐 정확히 1 이어야 한다.
//   · 테스트가 대상 파일을 실제로 로드해야 한다 — 훅이 적용할 때마다 표시를 남기고, 표시가 없으면 멈춘다.
//   · 로드된 소스에서 원문을 못 찾으면 훅이 던진다(디스크에서 읽은 것과 로드된 것이 다를 때).
// - **identity 변이로 장치를 먼저 확인한다.** 원문을 원문으로 바꾸는(아무것도 안 바꾸는) 변이를 같은 훅으로 먼저 돌린다.
//   하나라도 실패하면 장치가 테스트를 깨뜨리는 것이니 변이 결과를 믿지 않는다. 대상이 로드되지 않는 것도 여기서 먼저 걸린다.
// - **격리를 끄지 않는다.** 처음엔 --test-isolation=none 이 필요하다고 보고 그 이유를 여기 적으려 했는데, 실측이 그
//   전제를 뒤집었다 — Node v26.5.0 의 node --test 는 --import 를 테스트 파일마다의 자식 프로세스에 넘긴다(파일 2개 →
//   2개 프로세스에서 적용, 격리를 끈 때와 결과가 같았다). 그래서 평소 node --test 와 같은 조건으로 돌리고, 적용 표시는
//   프로세스마다 센다.
// - **Stop 훅에서 돌리지 않는다 — 수동 도구다.** .claude/hooks/run-tests.mjs 는 scripts/ 를 node --check 로 문법 검사만 한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const APPLIED = "MUTATION-CONTROL-APPLIED";
const HOOK_THREW = "MUTATION-CONTROL-HOOK";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(2);
}

const { values, positionals: testFiles } = parseArgs({
  options: {
    file: { type: "string" },
    find: { type: "string" },
    replace: { type: "string" },
    name: { type: "string" },
  },
  allowPositionals: true,
});
if (!values.file || values.find === undefined || values.replace === undefined || testFiles.length === 0) {
  fail('사용법: mutation-control.mjs --file <대상> --find "<원문>" --replace "<바꿀 글>" [--name <이름>] <테스트 파일…>');
}
if (values.find === values.replace) {
  fail("--replace 가 --find 와 같다 — 그건 identity 변이다. 이 도구가 변이 전에 알아서 먼저 돌린다");
}

const target = resolve(values.file);
let source;
try {
  source = readFileSync(target, "utf8");
} catch (e) {
  fail(`${values.file} 를 읽지 못했다 — ${e.message}`);
}
// 줄바꿈을 대상에 맞춘다. 작업본은 core.autocrlf 때문에 파일마다 CRLF·LF 가 다르고 한 파일 안에서 섞이기도 한다(popover.js).
// 셸에서 넘긴 여러 줄 원문은 LF 라, 처음엔 CRLF 파일에서 0번 일치로 멈춰 쓸 수가 없었다. 원문 그대로와 줄바꿈을 바꾼
// 변환형(LF→CRLF, 원문이 CRLF 면 CRLF→LF)의 일치 수를 **합쳐** 정확히 1 일 때만 적용한다 — 따로따로 한 번씩 보면 섞인 파일에서
// 두 구간에 다 있는 원문을 하나로 착각한다.
const toCRLF = (t) => t.replace(/\r?\n/g, "\r\n");
const toLF = (t) => t.replace(/\r\n/g, "\n");
const findHasCRLF = values.find.includes("\r\n");
const converted = findHasCRLF ? toLF(values.find) : toCRLF(values.find);
const count = (t) => source.split(t).length - 1;
const asIs = count(values.find);
const asConverted = converted === values.find ? 0 : count(converted);
if (asIs + asConverted !== 1) {
  fail(`--find 가 ${values.file} 에 원문 그대로 ${asIs}번 · 줄바꿈 변환형 ${asConverted}번 나온다 — ` +
    "합쳐 정확히 한 번이어야 어느 것을 바꿨는지 안다");
}
const useConverted = asConverted === 1;
const find = useConverted ? converted : values.find;
const replacement = useConverted ? (findHasCRLF ? toLF(values.replace) : toCRLF(values.replace)) : values.replace;

// 훅은 로더 스레드에서 돈다. data: URL 로 넘겨 리포에 파일을 하나 더 두지 않는다.
// 경로 비교는 URL pathname 끼리, 대소문자 무시(윈도 드라이브 문자·경로가 대소문자를 가리지 않는다).
const HOOKS = `
let M;
export async function initialize(data) { M = data; }
export async function load(url, context, next) {
  const result = await next(url, context);
  if (!url.startsWith("file:") || new URL(url).pathname.toLowerCase() !== M.target) return result;
  const loaded = String(result.source);
  if (!loaded.includes(M.find)) {
    throw new Error("${HOOK_THREW}: 로드된 " + url + " 에 --find 원문이 없다");
  }
  console.error("${APPLIED} pid=" + process.pid);
  return { ...result, source: loaded.replace(M.find, M.replace), shortCircuit: true };
}`;
const REGISTER = `import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(${JSON.stringify(HOOKS)}), import.meta.url,
  { data: JSON.parse(process.env.MUTATION_CONTROL) });`;
const registerUrl = `data:text/javascript,${encodeURIComponent(REGISTER)}`;

/** 같은 훅으로 테스트를 돌리고 spec 리포터 출력에서 결과를 읽는다. */
function run(replace) {
  const r = spawnSync(process.execPath, ["--import", registerUrl, "--test", "--test-reporter=spec", ...testFiles], {
    env: {
      ...process.env,
      MUTATION_CONTROL: JSON.stringify({ target: pathToFileURL(target).pathname.toLowerCase(), find, replace }),
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return {
    out,
    hookThrew: out.includes(HOOK_THREW),
    applied: new Set([...out.matchAll(new RegExp(`${APPLIED} pid=(\\d+)`, "g"))].map((m) => m[1])).size,
    pass: Number(out.match(/^ℹ pass (\d+)/m)?.[1]),
    fail: Number(out.match(/^ℹ fail (\d+)/m)?.[1]),
    // 맨 앞 칸의 ✖ 만 — 시간 표기가 붙은 줄이 테스트다("✖ failing tests:" 머리글은 빠진다).
    failed: [...new Set([...out.matchAll(/^✖ (.+) \([\d.]+ms\)$/gm)].map((m) => m[1]))],
    messages: [...new Set([...out.matchAll(/AssertionError \[ERR_ASSERTION\]: (.+)/g)].map((m) => m[1]))],
  };
}

function checkRan(r, what) {
  if (r.hookThrew) fail(`${what}: 훅이 멈췄다 — 로드된 ${values.file} 에 원문이 없다(디스크와 다르다)`);
  if (!Number.isFinite(r.pass) || !Number.isFinite(r.fail)) fail(`${what}: 테스트가 끝나지 않았다 — 출력:\n${r.out}`);
  if (r.applied === 0) fail(`${what}: 어떤 테스트 파일도 ${values.file} 를 로드하지 않았다 — 변이가 테스트에 닿지 않는다`);
}

// 1) identity — 장치가 테스트를 깨뜨리지 않는지, 대상이 실제로 로드되는지 먼저 본다.
const identity = run(find);
checkRan(identity, "identity");
if (identity.fail > 0) {
  fail(`identity 변이에서 ${identity.fail}개가 실패했다 — 장치가 테스트를 깨뜨린다. 변이 결과를 믿지 않는다:\n  ` +
    identity.failed.join("\n  "));
}
console.log(`identity: ${identity.pass}개 통과 · 0개 실패 · ${values.file} 를 ${identity.applied}개 프로세스가 로드 — 장치 정상`);

// 2) 변이
const label = values.name ?? `${values.file}: "${values.find}" → "${values.replace}"`;
const mutant = run(replacement);
checkRan(mutant, "변이");
console.log(`변이 ${label}: ${mutant.pass}개 통과 · ${mutant.fail}개 실패 (${mutant.applied}개 프로세스에 적용)`);
if (mutant.fail > 0) {
  console.log("CAUGHT — 테스트가 이 변이를 잡는다");
  for (const t of mutant.failed) console.log(`  ✖ ${t}`);
  for (const m of mutant.messages) console.log(`    → ${m}`);
  process.exit(0);
}
console.log("SURVIVED — 변이가 적용됐는데 모두 통과했다. 테스트가 이 실패를 잡지 못한다");
process.exit(1);
