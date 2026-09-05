// 이동 단계에서 "사라진 줄"을 회계한다 — 옮긴 내용의 동일성만 보면 삭제는 안 잡힌다.
// 4단계 검증은 옮긴 426줄이 원문과 같음을 확인했으나, main.js 에서 그 밖에 무엇이
// 없어졌는지는 보지 않았다(줄 수가 16줄 어긋났다). 이 스크립트가 그 반대편을 본다.
//
// 사용법:
//   git show <직전 단계 커밋 해시>:js/main.js > /tmp/old-main.js
//   node scripts/check-move-accounting.mjs /tmp/old-main.js js/main.js js/probview.js
// HEAD~n 을 쓰지 마라 — 커밋이 하나만 쌓여도 다른 스냅샷과 비교하고 결과는 통과로 보인다.
//
// 판정: 옛 main.js 에 있었으나 새 main.js 에도, 옮긴 파일 어디에도 없는 줄이 있으면 실패.
// 빈 줄과 순수 공백 줄은 세지 않는다(블록을 떼면 필연적으로 어긋난다).
import { readFileSync } from "node:fs";

const [oldPath, newPath, ...movedPaths] = process.argv.slice(2);
if (!oldPath || !newPath || movedPaths.length === 0) {
  console.error("사용법: check-move-accounting.mjs <옛 main.js> <새 main.js> <옮긴 파일...>");
  process.exit(2);
}

const read = (p) => {
  let t = readFileSync(p, "utf8");
  if (t.length === 0) { console.error(`FAIL: ${p} 가 비었다`); process.exit(2); }
  // PowerShell 리다이렉션은 BOM 을 붙인다. 지우지 않으면 첫 줄이 영원히 미회계로 나온다.
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  // UTF-16 으로 저장된 파일을 조용히 오독하지 않는다(PS 5.1 의 > 기본값).
  if (t.includes("\u0000")) {
    console.error(`FAIL: ${p} 에 NUL 이 있다 — UTF-16 으로 저장된 것 같다. ` +
      `PowerShell 의 > 대신 Git Bash 나 -Encoding utf8 로 다시 만들어라`);
    process.exit(2);
  }
  return t.split(/\r?\n/);
};

// 다중집합 — 같은 줄이 세 번 사라졌으면 세 번 나타나야 한다.
const bag = (lines) => {
  const m = new Map();
  for (const raw of lines) {
    const s = raw.trim();
    if (s === "") continue;
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
};

const oldLines = read(oldPath);
const newBag = bag(read(newPath));
const movedBag = new Map();
for (const p of movedPaths) {
  for (const [k, v] of bag(read(p))) movedBag.set(k, (movedBag.get(k) ?? 0) + v);
}

const take = (m, k) => {
  const n = m.get(k) ?? 0;
  if (n === 0) return false;
  m.set(k, n - 1);
  return true;
};

const unaccounted = [];
oldLines.forEach((raw, i) => {
  const s = raw.trim();
  if (s === "") return;
  if (take(newBag, s)) return;      // 새 main.js 에 남아 있다
  if (take(movedBag, s)) return;    // 옮긴 파일로 갔다
  unaccounted.push({ line: i + 1, text: raw });
});

// 반대 방향도 본다: 어느 쪽에도 근거가 없는 새 줄(배선·import 는 여기 나온다).
const introduced = [];
for (const [s, n] of newBag) if (n > 0) introduced.push({ text: s, count: n });

console.log(`옛 ${oldPath}: ${oldLines.length}줄 / 새 ${newPath}: ${read(newPath).length}줄`);
console.log(`옮긴 파일: ${movedPaths.join(", ")}`);
console.log("");

if (introduced.length > 0) {
  console.log(`새로 추가된 줄 ${introduced.reduce((a, x) => a + x.count, 0)}개 (배선·import 여야 한다):`);
  for (const x of introduced) console.log(`  + ${x.count > 1 ? `[x${x.count}] ` : ""}${x.text}`);
  console.log("");
}

if (unaccounted.length > 0) {
  console.error(`FAIL: 어디에도 없는 줄 ${unaccounted.length}개 — 삭제됐거나 수정됐다`);
  for (const x of unaccounted) console.error(`  - ${oldPath}:${x.line}  ${x.text}`);
  console.error("\n이동 단계에서는 삭제도 수정도 하지 않기로 했다. " +
    "의도한 치환이면 계획서에 적고, 아니면 되돌려라.");
  process.exit(1);
}

console.log("OK: 사라진 줄 0개 — 모두 새 main.js 또는 옮긴 파일에 있다");
