// import 대상 검사 — 브라우저가 js/ 를 불러올 때 낼 연결 오류를 Node 에서 미리 낸다. 모듈을 실행하지는 않는다.
//
// 왜: node --check 는 파싱만 하고 지정자를 풀지 않는다. node --test 는 테스트가 import 한 모듈만 연결한다 — main · grid · gatemenu
// · playback · probview · scene 은 DOM 을 잡아 Node 에서 import 되지 않는다. 그 안의 경로 · 이름이 틀리면 두 검사를 다 통과한 채
// main 에 올라가 공개 사이트가 통째로 죽는다(683d624 — js/ 를 하위 폴더로 옮기고 경로를 안 고쳤다). 2026-11-01 메모리 변이로 잰 것:
// grid.js 의 경로 한 글자, 없는 export 이름, 그리고 테스트가 import 하는 circuit.js 의 **대소문자만 틀린 경로**까지 셋 다 통과했다.
// Windows 는 대소문자를 가리지 않아 그대로 로드하지만 GitHub Pages 는 404 를 낸다.
//
// 어떻게: V8 이 모듈을 연결(link)만 하고 실행(evaluate)하지 않는다. 없는 export 는 브라우저와 같은 SyntaxError 로 나온다.
// vm.SourceTextModule 은 Node v26.5.0 에서 --experimental-vm-modules 아래에서만 있다(없으면 undefined, 실측). node --test 는 인자 없이
// 돌아 테스트 프로세스에 플래그를 줄 수 없다 — 그래서 **자식 프로세스 하나**를 그 플래그로 띄운다. 자식은 디스크를 읽지 않고
// 소스를 stdin 으로 받는다. 부모가 readFileSync 로 읽어야 scripts/mutation-control.mjs 의 변이가 이 검사에 닿는다.
// 플래그나 API 가 바뀌면 건너뛰지 않고 실패한다. 네트워크에는 나가지 않는다.
//
// 알려진 한계:
// - 맨 이름(three)은 받아 오지 않는다. 대역 모듈을 세우고, 가져오는 이름은 BARE_EXPORTS 표로만 맞춘다. 그 이름이
//   three@0.160.0 에 정말 있는지는 사람이 확인한다.
// - 네임스페이스 속성 오타(THREE.Foo)는 연결 단계에서 잡히지 않는다 — 속성 접근은 실행 때 풀린다.
// - 동적 import() 는 문자열 리터럴만 허용한다. 템플릿 · 변수 경로는 실행 때 정해져 검사할 수 없으므로 실패로 친다. 동적 import 로
//   받은 이름도 실행 때 풀려 보지 않는다.
// - 한 모듈에 풀리지 않는 경로가 있으면 그 모듈의 이름 검사는 경로를 고친 뒤에 돈다(경로 쪽 테스트가 먼저 실패한다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 하위 폴더까지 — 683d624 가 바로 js/core · js/model · js/ui 로 옮긴 커밋이었다. 이름은 readdirSync 가 낸 그대로다(대소문자 판정의 기준).
const JS_FILES = readdirSync(join(ROOT, "js"), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
  .map((e) => [...relative(ROOT, e.parentPath).split(sep), e.name].join("/"))
  .sort();

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const IMPORTS = JSON.parse(HTML.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? "{}").imports ?? {};
const MODULE_SCRIPTS = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([, attrs]) => /\btype=["']module["']/.test(attrs))
  .map(([, attrs, body]) => ({ src: attrs.match(/\bsrc=["']([^"']+)["']/)?.[1] ?? null, body }));
const ENTRIES = MODULE_SCRIPTS.filter((s) => s.src).map((s) => s.src);

// 연결할 소스: js 파일 전부와 index.html 의 인라인 모듈 스크립트(지금은 없다 — 생기면 같은 검사를 받는다).
const SOURCES = Object.fromEntries([
  ...JS_FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
  ...MODULE_SCRIPTS.filter((s) => !s.src && s.body.trim()).map((s, k) => [`index.html#module${k}`, s.body]),
]);

// 맨 이름 대역이 내보내는 이름. 이 표가 있어야 three 쪽 이름 오타(OrbitControl)도 연결 오류로 잡힌다 — 그것도 브라우저에서 앱 전체를
// 죽이는 같은 종류다. three 는 네임스페이스(`* as THREE`)로만 가져와 이름이 필요 없다.
const BARE_EXPORTS = {
  "three": [],
  "three/addons/controls/OrbitControls.js": ["OrbitControls"],
  "three/addons/environments/RoomEnvironment.js": ["RoomEnvironment"],
};

// 평소 수백 ms 다. 멈추면 node --test 와 Stop 훅(120초)이 같이 멈추므로 끊는다.
const CHILD_TIMEOUT_MS = 20_000;

/**
 * 지정자 하나를 푼다. files: 있는 모듈 경로(리포 기준, readdirSync 이름 그대로), imports: importmap 의 imports.
 * 반환: { kind: "relative"|"bare"|"root"|"url", target?, problem? } — problem 이 있으면 브라우저에서 깨진다.
 * **순수 함수다** — 자식 프로세스에도 소스 그대로 넘어가 연결에 쓰이므로 바깥 이름을 쓰지 않는다.
 */
function resolveSpecifier(spec, importer, files, imports) {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
    const parts = [];
    for (const seg of `${dir}/${spec}`.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (parts.length === 0) return { kind: "relative", problem: "리포 밖을 가리킨다" };
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    const target = parts.join("/");
    if (files.includes(target)) return { kind: "relative", target };
    const near = files.find((f) => f.toLowerCase() === target.toLowerCase());
    return { kind: "relative", target, problem: near ? `대소문자만 다르다 — 디스크에는 ${near}` : "없는 파일" };
  }
  if (spec.startsWith("/")) return { kind: "root", problem: "루트 경로 — Pages 는 /quantumtools/ 아래라 다른 곳을 가리킨다" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return { kind: "url", problem: "URL 지정자 — 외부 모듈은 index.html importmap 으로만 들인다" };
  if (Object.hasOwn(imports, spec)) return { kind: "bare", target: spec };
  const prefix = Object.keys(imports).filter((k) => k.endsWith("/") && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return prefix ? { kind: "bare", target: spec } : { kind: "bare", problem: "index.html importmap 에 없는 맨 이름" };
}

/**
 * 소스 안의 동적 import() 중 코드인 것. V8 이 판정한다 — 그 자리에 "@" 를 끼운 소스가 SyntaxError 면 코드이고, 아니면 주석 · 문자열 ·
 * 템플릿이다(정규식만으로는 주석의 "import()" 를 코드로 읽는다). 인자가 문자열 리터럴이 아니면 specifier 는 null. 자식에서 돈다.
 */
function findDynamicImports(source, vm) {
  const out = [];
  for (const m of source.matchAll(/(?<![\w$.])import\s*\(/g)) {
    const at = m.index + "import".length;
    try {
      new vm.SourceTextModule(source.slice(0, at) + "@" + source.slice(at));
      continue; // 끼워도 파싱된다 — 코드가 아니다
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
    const literal = source.slice(m.index + m[0].length).match(/^\s*(["'])([^"'\\\n]*)\1\s*[,)]/);
    out.push({ line: source.slice(0, m.index).split("\n").length, specifier: literal ? literal[2] : null });
  }
  return out;
}

/** 자식 프로세스의 본체 — 소스를 stdin 으로 받아 모듈마다 지정자 · 동적 import 를 내고, 모듈마다 뿌리로 새로 연결한다. */
async function childMain() {
  const vm = await import("node:vm");
  if (typeof vm.SourceTextModule !== "function") {
    process.stdout.write(JSON.stringify({ fatal: "vm.SourceTextModule 이 없다 — --experimental-vm-modules 가 먹지 않았거나 Node 가 API 를 바꿨다" }));
    return;
  }
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const { files, sources, imports, bareExports } = JSON.parse(raw);
  const modules = {};
  for (const [id, source] of Object.entries(sources)) {
    try {
      const m = new vm.SourceTextModule(source, { identifier: id });
      modules[id] = { requests: m.moduleRequests.map((r) => r.specifier), dynamic: findDynamicImports(source, vm) };
    } catch (e) {
      modules[id] = { parseError: `${e.name}: ${e.message}` };
    }
  }
  // 뿌리마다 새 모듈로 연결한다 — 실패한 연결은 모듈을 오류 상태로 남겨 다음 뿌리의 결과를 흐린다. 26개 남짓이라 싸다.
  const link = {};
  for (const root of Object.keys(sources)) {
    if (modules[root].parseError) { link[root] = "unresolved"; continue; }
    const cache = new Map();
    let unresolved = false;
    const real = (id) => {
      if (!cache.has(id)) cache.set(id, new vm.SourceTextModule(sources[id], { identifier: id }));
      return cache.get(id);
    };
    const bare = (spec) => {
      if (!cache.has(`bare:${spec}`)) cache.set(`bare:${spec}`, new vm.SyntheticModule(bareExports[spec] ?? [], () => {}, { identifier: spec }));
      return cache.get(`bare:${spec}`);
    };
    // 풀 수 없는 지정자에서 던지지 않고 빈 대역을 돌려준다. 던지면 Node 가 같은 그래프의 다른 연결 프로미스를 처리되지 않은 거부로
    // 남겨 자식이 죽었다 — 깨진 경로가 둘 이상일 때다(683d624 를 풀어 돌려 실측, 경로 하나짜리 변이로는 안 보였다).
    const linker = (spec, ref) => {
      const r = resolveSpecifier(spec, ref.identifier, files, imports);
      if (r.problem || (r.kind === "relative" && modules[r.target]?.parseError)) {
        unresolved = true; // 경로 쪽 테스트의 몫이다 — 이름 검사에서는 세지 않는다
        return new vm.SyntheticModule([], () => {}, { identifier: `unresolved:${spec}` });
      }
      return r.kind === "bare" ? bare(spec) : real(r.target);
    };
    try {
      await real(root).link(linker);
      link[root] = unresolved ? "unresolved" : real(root).status === "linked" ? null : `연결 뒤 상태가 ${real(root).status}`;
    } catch (e) {
      link[root] = unresolved ? "unresolved" : e.message;
    }
  }
  process.stdout.write(JSON.stringify({ modules, link }));
}

let linked;
/** 자식을 한 번 돌린 결과(테스트끼리 나눠 쓴다). */
function linkResult() {
  if (linked) return linked;
  const code = `${resolveSpecifier}\n${findDynamicImports}\n(${childMain})().catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exitCode = 1; });`;
  const r = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e", code], {
    input: JSON.stringify({ files: JS_FILES, sources: SOURCES, imports: IMPORTS, bareExports: BARE_EXPORTS }),
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.error, undefined, `자식 프로세스를 띄우지 못했거나 ${CHILD_TIMEOUT_MS}ms 안에 끝나지 않았다: ${r.error?.message}`);
  assert.equal(r.status, 0, `자식 프로세스가 실패했다(exit ${r.status}, signal ${r.signal}).\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.fatal, undefined, out.fatal);
  linked = out;
  return linked;
}

/** 모듈마다 풀린 지정자 — 정적 import 만. */
function staticRequests() {
  const { modules } = linkResult();
  return Object.entries(modules).flatMap(([id, m]) =>
    (m.requests ?? []).map((spec) => ({ id, spec, ...resolveSpecifier(spec, id, JS_FILES, IMPORTS) })));
}

test("상대 경로 import 와 진입 스크립트는 디스크의 파일을 대소문자까지 그대로 가리킨다 — GitHub Pages 는 대소문자를 가른다", () => {
  const relativeRequests = staticRequests().filter((r) => r.kind === "relative");
  assert.ok(relativeRequests.length > 0, "상대 import 를 하나도 보지 못했다 — js/ 를 못 읽었거나 자식이 지정자를 내지 않았다");
  const bad = relativeRequests.filter((r) => r.problem).map((r) => `${r.id} → "${r.spec}": ${r.problem}`);
  assert.ok(ENTRIES.length > 0, "index.html 에 type=module 진입 스크립트가 없다");
  for (const src of ENTRIES) {
    // HTML 의 src="js/main.js" 는 문서 기준 상대 경로다 — 지정자 규칙으로 풀려고 "./" 를 붙인다.
    const spec = /^(\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(src) ? src : `./${src}`;
    const r = resolveSpecifier(spec, "index.html", JS_FILES, IMPORTS);
    if (r.problem) bad.push(`index.html <script type="module" src="${src}">: ${r.problem}`);
  }
  assert.deepEqual(bad, []);
});

test("이름 붙은 import 는 대상 모듈의 export 에 있다 — V8 이 모듈을 연결만 하고 실행하지 않는다", () => {
  const { modules, link } = linkResult();
  assert.equal(Object.keys(link).length, Object.keys(SOURCES).length, "연결을 시도하지 않은 모듈이 있다");
  assert.ok(JS_FILES.length > 0, "js/ 에서 모듈을 하나도 찾지 못했다");
  const parse = Object.entries(modules).filter(([, m]) => m.parseError).map(([id, m]) => `${id}: ${m.parseError}`);
  const failing = Object.entries(link).filter(([, e]) => e && e !== "unresolved");
  // 한 모듈의 오류는 그것을 가져오는 모든 모듈의 연결도 깨뜨린다. 의존이 모두 홀로 연결되는데 자기만 실패하는 모듈이 원인이다
  // (순환 안에서는 원인을 못 가려 실패한 것을 다 보인다).
  const depsLink = (id) => (modules[id].requests ?? []).every((spec) => {
    const r = resolveSpecifier(spec, id, JS_FILES, IMPORTS);
    return r.kind !== "relative" || link[r.target] === null;
  });
  const culprits = failing.filter(([id]) => depsLink(id));
  const hint = (message) => {
    const spec = message.match(/requested module '([^']+)'/)?.[1];
    return spec && resolveSpecifier(spec, "", JS_FILES, IMPORTS).kind === "bare"
      ? " — 맨 이름 모듈이 내보내는 이름은 이 파일의 BARE_EXPORTS 표에 더한다(three@0.160.0 에 그 이름이 있는지는 사람이 확인한다)"
      : "";
  };
  const bad = (culprits.length ? culprits : failing).map(([id, e]) => `${id}: ${e}${hint(e)}`);
  assert.deepEqual([...parse, ...bad], []);
});

test("js/ 밖에서 가져오는 모듈은 index.html importmap 의 키를 거친다 — 루트 경로(/…) · URL 을 바로 쓰지 않는다", () => {
  const bad = staticRequests()
    .filter((r) => r.kind !== "relative" && r.problem)
    .map((r) => `${r.id} → "${r.spec}": ${r.problem}`);
  assert.deepEqual(bad, []);
});

test("동적 import() 는 문자열 리터럴로 있는 파일을 가리킨다 — 템플릿 · 변수 경로는 실행 때 정해져 검사할 수 없다", () => {
  const { modules } = linkResult();
  const bad = [];
  for (const [id, m] of Object.entries(modules)) {
    for (const d of m.dynamic ?? []) {
      if (d.specifier === null) { bad.push(`${id}:${d.line} 동적 import 의 경로가 문자열 리터럴이 아니다`); continue; }
      const r = resolveSpecifier(d.specifier, id, JS_FILES, IMPORTS);
      if (r.problem) bad.push(`${id}:${d.line} import("${d.specifier}"): ${r.problem}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("importmap 의 three 항목들은 같은 버전을 가리킨다 — 애드온은 맨 이름 three 를 importmap 으로 불러, 버전이 다르면 두 판이 섞인다", () => {
  const versions = Object.entries(IMPORTS)
    .map(([key, url]) => [key, url.match(/\/three@([^/]+)\//)?.[1]])
    .filter(([, v]) => v);
  assert.ok(versions.length >= 2, `three 항목을 둘 이상 찾지 못했다: ${JSON.stringify(IMPORTS)}`);
  assert.equal(new Set(versions.map(([, v]) => v)).size, 1, `버전이 갈렸다: ${versions.map(([k, v]) => `${k}@${v}`).join(", ")}`);
});
