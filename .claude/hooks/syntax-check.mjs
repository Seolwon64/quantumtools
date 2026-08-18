// PostToolUse(Write|Edit) 훅: 방금 편집한 .js/.mjs 를 파싱해 본다.
// 문법이 깨졌으면 stdout 에 decision:"block" JSON 을 내보내 그 자리에서 되돌린다.
// 이 리포엔 jq 가 없으므로 stdin JSON 파싱도 Node 로 한다.
//
// 이 훅은 루트 package.json 의 `"type": "module"` 에 의존한다. 그게 없으면 `.js` 가
// CJS/ESM 중 무엇인지 모호해지고, 그 모호한 경로에서 Node v26 의 --check 는 진짜
// 문법 오류를 조용히 통과시킨다(잘린 함수·짝 안 맞는 괄호·중간 오류 모두 exit 0).
// package.json 을 지우면 이 훅은 아무것도 안 잡으면서 통과하는 척한다.
import { execFile } from "node:child_process";

const CHECKABLE = /\.(js|mjs)$/;

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // 훅 입력을 못 읽으면 조용히 비켜선다 — 편집을 막을 근거가 없다
  }

  const file =
    input?.tool_response?.filePath ?? input?.tool_input?.file_path ?? "";
  if (!CHECKABLE.test(file)) process.exit(0);

  execFile(process.execPath, ["--check", file], (err, _stdout, stderr) => {
    if (!err) return; // 통과하면 아무것도 출력하지 않는다
    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: `${file} 문법 오류:\n${stderr.trim()}`,
      }),
    );
  });
});
