// 모듈 최상위 이름을 함수 안에서 다시 선언하는 것을 막는다 — 4단계 chartTooltip 회귀 방지.
// 배경: 최상위 `const x = ...` 를 init 함수 안으로 옮기면 글자는 같지만 최상위 x 는
// undefined 로 남는다. node --check 도 node --test 도 이것을 잡지 못한다.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "js";

// ── 토큰 제거 ───────────────────────────────────────────────────────────────
// 문자열·템플릿·주석·정규식 리터럴을 공백으로 지운다. 길이를 보존해 위치를 유지한다.
// 지우지 못하는 형태를 만나면 던진다 — 조용히 통과시키지 않는다.
function blankLiterals(src, file) {
  const out = src.split("");
  const isRegexStart = (i) => {
    for (let j = i - 1; j >= 0; j--) {
      const c = out[j];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
      // 식별자·숫자·닫는 괄호 뒤의 / 는 나눗셈이다.
      return !/[\w$)\]]/.test(c);
    }
    return true;
  };
  let i = 0;
  const tmplStack = []; // 템플릿 안 ${} 중첩 추적
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) throw new Error(`${file}: 닫히지 않은 블록 주석 (offset ${i})`);
      for (let j = i; j < end + 2; j++) if (out[j] !== "\n") out[j] = " ";
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out[i] = " ";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { out[i] = " "; i++; }
        if (src[i] === "\n") throw new Error(`${file}: 닫히지 않은 문자열 (offset ${i})`);
        out[i] = " ";
        i++;
      }
      if (i >= src.length) throw new Error(`${file}: 닫히지 않은 문자열`);
      out[i] = " ";
      i++;
      continue;
    }
    if (c === "`") {
      out[i] = " ";
      i++;
      // 템플릿 본문은 지우되 ${...} 안은 코드이므로 남긴다.
      while (i < src.length) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === "`") { out[i] = " "; i++; break; }
        if (src[i] === "$" && src[i + 1] === "{") {
          tmplStack.push(true);
          i += 2; // ${ 와 그 안은 그대로 둔다
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth === 0) break;
            i++;
          }
          i++; // 닫는 }
          continue;
        }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && isRegexStart(i)) {
      out[i] = " ";
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { out[i] = " "; i++; break; }
        else if (src[i] === "\n") throw new Error(`${file}: 닫히지 않은 정규식 (offset ${i})`);
        out[i] = " ";
        i++;
      }
      while (i < src.length && /[gimsuyvd]/.test(src[i])) { out[i] = " "; i++; }
      continue;
    }
    i++;
  }
  return out.join("");
}

// ── 선언 수집 ───────────────────────────────────────────────────────────────
// \s+ 를 강제한다 — 없으면 className/classList 의 "class" 가 걸린다.
const DECL = /\b(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g;
const DESTRUCT = /\b(?:const|let|var)\s+([[{])/g;

function namesIn(fragment) {
  // { a, b: c, d = 1, ...rest } / [a, b] 에서 바인딩되는 이름만.
  const names = [];
  const re = /([A-Za-z_$][\w$]*)\s*(:)?/g;
  let m;
  while ((m = re.exec(fragment))) {
    if (m[2]) { // a: b → b 가 바인딩
      const after = /\s*([A-Za-z_$][\w$]*)/.exec(fragment.slice(re.lastIndex));
      if (after) { names.push(after[1]); re.lastIndex += after[0].length; }
      continue;
    }
    names.push(m[1]);
  }
  return names;
}

function matchBracket(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// 중괄호 깊이와, **그 중괄호 층 안에서의** 소괄호 깊이를 센다.
// 소괄호 깊이를 전역으로 세면 콜백 본문(`arr.map((x) => { ... })`)이 통째로
// 괄호 안으로 잡혀 검사에서 빠진다. 블록에 들어갈 때 괄호 깊이를 쌓아 두고 0부터
// 다시 센다 — 그래야 "for 머리·매개변수"만 걸러지고 콜백 본문은 남는다.
function depthsOf(text, file) {
  const brace = new Int32Array(text.length);
  const paren = new Int32Array(text.length);
  const stack = [];
  let b = 0, p = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") { brace[i] = b; paren[i] = p; b++; stack.push(p); p = 0; continue; }
    if (c === "}") {
      b--;
      if (stack.length === 0) throw new Error(`${file}: 중괄호 불균형 (offset ${i})`);
      p = stack.pop();
      brace[i] = b; paren[i] = p;
      continue;
    }
    if (c === "(") { paren[i] = p; p++; brace[i] = b; continue; }
    if (c === ")") { p--; paren[i] = p; brace[i] = b; continue; }
    brace[i] = b; paren[i] = p;
  }
  if (b !== 0) throw new Error(`${file}: 중괄호 불균형 (최종 depth ${b})`);
  if (p !== 0) throw new Error(`${file}: 소괄호 불균형 (최종 depth ${p})`);
  return { brace, paren };
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

function collect(file) {
  const src = readFileSync(file, "utf8");
  const clean = blankLiterals(src, file);
  const { brace, paren } = depthsOf(clean, file);
  const top = new Map();     // name → line
  const nested = new Map();  // name → [line]

  const add = (name, index) => {
    if (paren[index] !== 0) return; // for 머리·매개변수 — 블록 스코프다
    const line = lineOf(src, index);
    if (brace[index] === 0) { if (!top.has(name)) top.set(name, line); }
    else { if (!nested.has(name)) nested.set(name, []); nested.get(name).push(line); }
  };

  let m;
  DECL.lastIndex = 0;
  while ((m = DECL.exec(clean))) add(m[1] ?? m[2], m.index);

  DESTRUCT.lastIndex = 0;
  while ((m = DESTRUCT.exec(clean))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(clean, open);
    if (close === -1) throw new Error(`${file}: 닫히지 않은 구조분해 (line ${lineOf(src, open)})`);
    for (const n of namesIn(clean.slice(open + 1, close))) add(n, open);
  }
  return { top, nested };
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const files = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
if (files.length === 0) {
  console.error(`FAIL: ${DIR}/ 에 .js 파일이 없다 — 경로를 확인하라`);
  process.exit(2);
}

let violations = 0;
for (const f of files) {
  const path = join(DIR, f);
  let r;
  try {
    r = collect(path);
  } catch (e) {
    console.error(`FAIL ${path}: 파싱 불가 — ${e.message}`);
    process.exit(2);
  }
  if (r.top.size === 0) {
    console.error(`FAIL ${path}: 최상위 선언 0개 — 토큰 제거가 잘못됐을 수 있다`);
    process.exit(2);
  }
  for (const [name, lines] of r.nested) {
    if (!r.top.has(name)) continue;
    violations++;
    console.error(
      `FAIL ${path}: '${name}' 이 최상위(line ${r.top.get(name)})와 ` +
      `함수 안(line ${lines.join(", ")})에서 모두 선언된다`
    );
  }
}

if (violations > 0) {
  console.error(`\n${violations}건. 함수 안 선언이 최상위 이름을 가린다 — ` +
    `옮긴 코드라면 const/let 을 대입으로 바꿔라.`);
  process.exit(1);
}
console.log(`OK: ${files.length}개 파일, 섀도잉 0건`);
