// 폰트 파일 · @font-face · preload · 서브셋 이름 · 글리프 범위 · 굵기 상한 — design-spec "타이포그래피" 의 규칙을 소스로 지킨다.
// 브라우저 없이 텍스트와 woff2 바이트만 읽는다. woff2 는 Node 내장 zlib(brotli)로 풀어 name·cmap 표만 읽는다(의존성 없음).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";

const ROOT = new URL("../", import.meta.url);
const readText = (p) => readFileSync(new URL(p, ROOT), "utf8");
const readBytes = (p) => readFileSync(new URL(p, ROOT));
const FONT_FILES = readdirSync(new URL("fonts/", ROOT));
const JS_FILES = readdirSync(new URL("js/", ROOT)).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`);

// ---------- CSS ----------
const CSS = readText("style.css").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const FACES = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: body.match(/font-family:\s*"([^"]+)"/)?.[1],
  src: body.match(/src:\s*url\("([^"]+)"\)/)?.[1],
  range: body.match(/unicode-range:\s*([^;]+);/)?.[1].replace(/\s+/g, " ").trim(),
}));

/** "U+0020-007E, U+00A0" → [[0x20, 0x7e], [0xa0, 0xa0]] */
function parseRange(s) {
  return s.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
    if (!m) throw new Error(`unicode-range 를 못 읽었다: ${p}`);
    return [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)];
  });
}
const expand = (ranges) => new Set(ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)));
const hex = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

// ---------- JS: 주석을 뺀 코드와 문자열 리터럴 ----------
// 정규식 리터럴·템플릿(${} 안의 코드 포함)을 구분해, 주석 안의 글자와 문자열 안의 // 를 헷갈리지 않는다.
function scanJs(src) {
  const strings = [];
  let out = "";
  const regexAllowed = () => {
    const t = out.replace(/\s+$/, "");
    if (!t) return true;
    if ("(,=:[!&|?{};+-*%<>~^".includes(t[t.length - 1])) return true;
    return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(t);
  };
  // before = 문자열이 **시작하기 직전**의 코드(console.warn( 인지 보려고). 템플릿은 ${} 안의 코드가 읽는 동안 out 에 붙으므로
  // 끝에서 재면 그 식이 잡힌다 — 시작할 때 잰다.
  const push = (text, before) => strings.push({ text, before });
  function quoted(i, q) {
    const before = out.slice(-48);
    let j = i + 1, text = "";
    while (j < src.length && src[j] !== q) { if (src[j] === "\\") { text += src[j] + src[j + 1]; j += 2; continue; } text += src[j++]; }
    push(text, before); out += q + text + q;
    return j + 1;
  }
  function template(i) {
    const before = out.slice(-48);
    let j = i + 1, text = "";
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") { text += src[j] + src[j + 1]; j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") { text += "${}"; j = code(j + 2, true); continue; }
      text += src[j++];
    }
    push(text, before); out += "`" + text + "`";
    return j + 1;
  }
  function regex(i) {
    let j = i + 1, inClass = false;
    while (j < src.length) { const c = src[j]; if (c === "\\") { j += 2; continue; } if (c === "[") inClass = true; else if (c === "]") inClass = false; else if (c === "/" && !inClass) break; else if (c === "\n") break; j++; }
    j++; while (/[a-z]/i.test(src[j] ?? "")) j++;
    out += src.slice(i, j);
    return j;
  }
  function code(i, untilBrace) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; continue; }
      if (c === '"' || c === "'") { i = quoted(i, c); continue; }
      if (c === "`") { i = template(i); continue; }
      if (c === "/" && regexAllowed()) { i = regex(i); continue; }
      if (untilBrace && c === "{") depth++;
      if (untilBrace && c === "}") { if (depth === 0) return i + 1; depth--; }
      out += c; i++;
    }
    return i;
  }
  code(0, false);
  return { code: out, strings };
}
const JS = JS_FILES.map((file) => ({ file, ...scanJs(readText(file)) }));

// ---------- woff2: name · cmap ----------
const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
function woff2Tables(buf) {
  assert.equal(buf.toString("latin1", 0, 4), "wOF2", "woff2 서명이 아니다");
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => { let v = 0; for (let k = 0; k < 5; k++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error("UIntBase128"); };
  const dir = [];
  for (let k = 0; k < numTables; k++) {
    const flags = buf[p++];
    const tag = (flags & 0x3f) === 0x3f ? buf.toString("latin1", p, (p += 4)) : WOFF2_TAGS[flags & 0x3f];
    const version = flags >> 6, origLength = base128();
    // glyf·loca 는 버전 3 이 "변환 없음", 다른 표는 버전 0 이 "변환 없음"
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressed));
  const tables = {};
  let off = 0;
  for (const t of dir) { tables[t.tag] = data.subarray(off, off + t.length); off += t.length; }
  assert.equal(off, data.length, "풀린 길이와 표 길이 합이 다르다");
  return tables;
}
function nameRecords(b) {
  const count = b.readUInt16BE(2), strOff = b.readUInt16BE(4), out = [];
  for (let k = 0; k < count; k++) {
    const r = 6 + k * 12, platform = b.readUInt16BE(r), nameID = b.readUInt16BE(r + 6), len = b.readUInt16BE(r + 8), o = b.readUInt16BE(r + 10);
    const s = b.subarray(strOff + o, strOff + o + len);
    let text = "";
    if (platform === 3 || platform === 0) for (let k2 = 0; k2 + 1 < s.length; k2 += 2) text += String.fromCharCode(s.readUInt16BE(k2));
    else text = s.toString("latin1");
    out.push({ nameID, text });
  }
  return out;
}
function cmapCodepoints(b) {
  const cps = new Set();
  for (let k = 0; k < b.readUInt16BE(2); k++) {
    const off = b.readUInt32BE(8 + k * 8), fmt = b.readUInt16BE(off);
    if (fmt === 4) {
      const segX2 = b.readUInt16BE(off + 6), ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(ends + 2 * s), start = b.readUInt16BE(starts + 2 * s), delta = b.readInt16BE(deltas + 2 * s), ro = b.readUInt16BE(ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const g = ro === 0 ? (c + delta) & 0xffff : (() => { const gi = b.readUInt16BE(ranges + 2 * s + ro + 2 * (c - start)); return gi === 0 ? 0 : (gi + delta) & 0xffff; })();
          if (g !== 0) cps.add(c);
        }
      }
    } else if (fmt === 12) {
      for (let gI = 0; gI < b.readUInt32BE(off + 12); gI++) { const r = off + 16 + gI * 12; for (let c = b.readUInt32BE(r); c <= b.readUInt32BE(r + 4); c++) cps.add(c); }
    }
  }
  return cps;
}

// ---------- design-spec "타이포그래피" ----------
function specSection(title) {
  const spec = readText("docs/design-spec.md");
  const start = spec.search(new RegExp(`^## \\d+\\. ${title}`, "m"));
  assert.ok(start >= 0, `design-spec 에 "${title}" 절이 없다`);
  const rest = spec.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

test("JS 는 폰트 이름을 문자열로 적지 않는다 — 캔버스 글꼴도 --font-sans 토큰을 읽는다(두 곳에 적으면 한쪽만 바뀐다)", () => {
  const names = [...new Set(FACES.map((f) => f.family))].concat(["Geist"]);
  const hits = [];
  for (const { file, code } of JS) for (const n of names) if (code.includes(n)) hits.push(`${file}: "${n}"`);
  assert.deepEqual(hits, [], `주석 밖에 폰트 이름이 있다:\n${hits.join("\n")}`);
});

test("@font-face 와 preload 경로는 정확히 fonts/<파일> 이고 그 이름이 fonts/ 에 대소문자까지 같은 파일로 있다 — GitHub Pages 는 /quantumtools/ 아래이고 대소문자를 가린다", () => {
  const bad = [];
  const check = (where, url) => {
    const m = /^fonts\/([^/\\:?#]+)$/.exec(url ?? "");
    if (!m) { bad.push(`${where}: "${url}" — 경로가 fonts/<파일> 이 아니다(앞의 "/"·스킴·하위 폴더 금지)`); return; }
    if (!FONT_FILES.includes(m[1])) bad.push(`${where}: "${m[1]}" 와 대소문자까지 같은 파일이 fonts/ 에 없다`);
  };
  for (const f of FACES) check(`@font-face ${f.family}`, f.src);
  const html = readText("index.html");
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(preloads.length > 0, "preload 가 하나도 없다");
  const srcs = new Set(FACES.map((f) => f.src));
  for (const tag of preloads) {
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    check("preload", href);
    if (!/\bas="font"/.test(tag)) bad.push(`preload ${href}: as="font" 가 없다`);
    if (!/\btype="font\/woff2"/.test(tag)) bad.push(`preload ${href}: type="font/woff2" 가 없다`);
    if (!/\scrossorigin(?:[\s=>/]|$)/.test(tag)) bad.push(`preload ${href}: crossorigin 이 없다 — 없으면 받은 파일을 @font-face 가 다시 받는다`);
    if (!srcs.has(href)) bad.push(`preload ${href}: 어느 @font-face 의 src 도 아니다(받기만 하고 쓰지 않는다)`);
  }
  const unused = FONT_FILES.filter((f) => f.endsWith(".woff2") && !srcs.has(`fonts/${f}`));
  for (const f of unused) bad.push(`fonts/${f}: 어느 @font-face 도 쓰지 않는다`);
  assert.deepEqual(bad, []);
});

test("fonts/ 의 woff2 는 SOURCES.md 에 적힌 SHA-256 과 같고, OFL 라이선스 파일이 함께 있다 — 출처를 모르는 폰트 파일이 섞이지 않는다", () => {
  // 해시는 .woff2 에만 건다 — 텍스트 파일은 Git for Windows 의 줄바꿈 변환으로 새 clone 에서 해시가 달라진다
  const rows = new Map();
  for (const line of readText("fonts/SOURCES.md").split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+\.woff2)`\s*\|\s*[\d,]+\s*\|\s*`([0-9a-f]{64})`\s*\|/);
    if (m) rows.set(m[1], m[2]);
  }
  const bad = [];
  for (const f of FONT_FILES.filter((x) => x.endsWith(".woff2"))) {
    const want = rows.get(f);
    const got = createHash("sha256").update(readBytes(`fonts/${f}`)).digest("hex");
    if (!want) bad.push(`${f}: SOURCES.md 에 없다`);
    else if (want !== got) bad.push(`${f}: SOURCES.md ${want.slice(0, 12)}… ≠ 파일 ${got.slice(0, 12)}…`);
  }
  for (const f of rows.keys()) if (!FONT_FILES.includes(f)) bad.push(`${f}: SOURCES.md 에는 있는데 파일이 없다`);
  assert.deepEqual(bad, []);
  const license = readText("fonts/LICENSE-IBMPlex.txt");
  assert.match(license, /SIL Open Font License, Version 1\.1/);
  assert.match(license, /Reserved Font Name "Plex"/);
});

test('직접 만든 서브셋(QT Math)은 이름 어디에도 "Plex" 가 없고 글자가 unicode-range · design-spec 목록과 정확히 같다 — OFL 예약 이름, 빠지거나 남는 글자', () => {
  const ours = FACES.filter((f) => !/^IBM Plex /.test(f.family));
  assert.ok(ours.length > 0, "IBM 원본이 아닌 면(QT Math)이 없다");
  const listLine = specSection("타이포그래피").split(/\r?\n/).find((l) => l.includes("QT Math 가 그리는 글자"));
  assert.ok(listLine, 'design-spec "타이포그래피" 에 "QT Math 가 그리는 글자" 줄이 없다');
  const specSet = new Set([...listLine.matchAll(/U\+([0-9A-F]{4,6})/g)].map((m) => parseInt(m[1], 16)));
  for (const face of ours) {
    assert.doesNotMatch(face.family, /plex/i, `@font-face family "${face.family}" 에 Plex 가 있다`);
    const t = woff2Tables(readBytes(face.src));
    const leaked = nameRecords(t.name).filter((r) => /plex/i.test(r.text) && ![0, 7, 13, 14].includes(r.nameID));
    assert.deepEqual(leaked.map((r) => `name ${r.nameID}: ${r.text}`), [], `${face.src} 의 이름 레코드에 예약 이름 "Plex" 가 있다(0·7·13·14 만 허용)`);
    const cmap = [...cmapCodepoints(t.cmap)].filter((c) => c > 0x20).sort((a, b) => a - b).map(hex);
    const range = [...expand(parseRange(face.range))].sort((a, b) => a - b).map(hex);
    assert.deepEqual(cmap, range, `${face.src} 의 cmap 과 unicode-range 가 다르다`);
    assert.deepEqual(range, [...specSet].sort((a, b) => a - b).map(hex), "unicode-range 와 design-spec 의 QT Math 글자 목록이 다르다");
  }
});

test("굵기는 700 을 넘지 않는다 — IBM Plex 의 굵기 축은 100~700 이라 그 위 값은 700 으로 그려진다(bolder 는 예외: 계산값만 커지고 그려지는 것은 700)", () => {
  const over = [];
  const look = (where, text) => {
    for (const m of text.matchAll(/font-weight:\s*(\d+)/g)) if (+m[1] > 700) over.push(`${where}: ${m[0]}`);
    for (const m of text.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)/g)) for (const w of m[1].split(/\s+/)) if (/^\d{3}$/.test(w) && +w > 700) over.push(`${where}: font: ${m[1].trim()}`);
    for (const m of text.matchAll(/font-variation-settings:[^;}]*["']wght["']\s*(\d+)/g)) if (+m[1] > 700) over.push(`${where}: ${m[0]}`);
  };
  look("style.css", CSS);
  look("index.html", readText("index.html").replace(/<!--[\s\S]*?-->/g, ""));
  for (const { file, code, strings } of JS) {
    // 캔버스 font 문자열("600 44px …", `600 ${px}px …`)과 style.fontWeight 대입
    for (const s of strings) for (const m of s.text.matchAll(/(?:^|[\s;])([1-9]00)\s+(?:\$\{\}|\d)/g)) if (+m[1] > 700) over.push(`${file}: "${s.text.slice(0, 40)}"`);
    for (const m of code.matchAll(/fontWeight\s*=\s*["'`]?(\d{3})/g)) if (+m[1] > 700) over.push(`${file}: ${m[0]}`);
    look(file, strings.map((s) => s.text).join("\n"));
  }
  assert.deepEqual(over, []);
});

// (마)가 빼는 글은 둘뿐이다. ① console.*( 바로 뒤의 문자열 — 개발자 콘솔로만 간다. ② 아래 목록 — 화면에 **나올 수 있는데**
// 범위 밖 글자를 알고 남긴 글. 처음엔 이 목록을 "화면에 나오지 않는 글" 이라 불렀는데, matrixFor 의 예외 문구는 circuit.js stateAt 이
// 사유로 화면에 띄운다 — 이름이 사실과 달랐다. 항목마다 backlog 행을 가리키고, 그 글을 고치면 항목도 지운다(아래 테스트가 지킨다).
// 목록은 늘리지 않는다 — 늘어나면 그 글을 영어로 바꿀 일이다.
const KNOWN_UNCOVERED = [
  {
    file: "js/quantum.js",
    text: "구현되지 않은 게이트",
    backlog: "matrixFor 의 예외 문구를 영어로 바꾼다",
    why: "행렬 없는 게이트가 엔진에 닿을 때만 나는 내부 오류 — 사용자 입력으로 닿는 길은 찾지 못했다",
  },
];
test("범위 밖 글자를 알고 남긴 예외는 그 파일의 문자열 하나에만 맞고 backlog 행을 가리킨다 — 예외가 넓어지거나 고친 뒤에도 남지 않게", () => {
  const backlog = readText("docs/backlog.md");
  const bad = [];
  for (const k of KNOWN_UNCOVERED) {
    const hits = (JS.find((j) => j.file === k.file)?.strings ?? []).filter((s) => s.text.includes(k.text));
    if (hits.length === 0) bad.push(`${k.file} "${k.text}": 맞는 문자열이 없다 — 고쳤다면 이 예외를 지운다`);
    if (hits.length > 1) bad.push(`${k.file} "${k.text}": 문자열 ${hits.length}개에 맞는다 — 예외가 넓어졌다`);
    if (!backlog.includes(k.backlog)) bad.push(`${k.file} "${k.text}": docs/backlog.md 에 "${k.backlog}" 행이 없다`);
  }
  assert.deepEqual(bad, []);
});
test("화면에 나올 수 있는 비ASCII 글자는 모두 어느 @font-face 의 unicode-range 에 든다 — 범위 밖 글자는 시스템 글꼴로 튀어 보인다", () => {
  const covered = expand(FACES.flatMap((f) => (f.range ? parseRange(f.range) : [])));
  const shown = new Map(); // cp → 어디
  const add = (where, text) => { for (const ch of text) { const cp = ch.codePointAt(0); if (cp > 0x7e && !shown.has(cp)) shown.set(cp, `${where}: ${text.trim().slice(0, 30)}`); } };
  for (const { file, strings } of JS) for (const s of strings) {
    if (/console\.\w+\(\s*$/.test(s.before)) continue;
    if (KNOWN_UNCOVERED.some((n) => n.file === file && s.text.includes(n.text))) continue;
    add(file, s.text);
  }
  add("index.html", readText("index.html").replace(/<!--[\s\S]*?-->/g, ""));
  for (const m of CSS.matchAll(/content:\s*"((?:\\.|[^"\\])*)"/g)) add("style.css content", m[1].replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))));
  const missing = [...shown].filter(([cp]) => !covered.has(cp)).map(([cp, where]) => `${hex(cp)} ${String.fromCodePoint(cp)} — ${where}`);
  assert.deepEqual(missing, []);
});
