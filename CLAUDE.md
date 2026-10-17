# quantumtools
브라우저에서 전부 도는 양자 회로 시뮬레이터 겸 시각화 도구. 게이트를 놓으면 상태벡터를 계산해 Bloch sphere(Three.js)·
Q-sphere·확률 차트·축소 밀도행렬로 보여 주고, OpenQASM 2.0 / Qiskit 코드와 공유 URL 로 내보낸다. 백엔드도 설치도 없다.

## 아키텍처 결정

- **빌드 도구 없음, 런타임 의존성 0.** `package.json` 에 `dependencies`·`devDependencies` 가 없고, 브라우저가 `js/*.js` 를
  ES 모듈로 직접 로드한다. 번들러나 npm 패키지를 전제한 제안은 하지 않는다.
- **Three.js 는 CDN importmap** — `index.html` 이 `three`·`three/addons/` 를 `https://unpkg.com/three@0.160.0/` 에 매핑한다.
  버전은 두 항목을 같이 올린다. 폰트는 `fonts/` 에 자체 호스팅한다 — 무엇을 쓰는지는 `style.css` 의 `@font-face`.
- **상태는 컨트롤러 하나가 갖는다.** 프레임워크가 없다. `circuit.js` 의 `createCircuitController({ onChange, onAnimateStep,
  onStepPause, initial })` 가 회로를 소유하고 콜백으로 알리며, `main.js` 가 그 콜백에서 DOM 을 갱신한다.
- **지속성은 `localStorage` 네 키** — `bloch-composer-v1`(회로), `bloch-layout-v5`(열 비율·행 오프셋), `bloch-code-panel-v2`
  (밴드 펼침·높이·탭), `bloch-prob-view-v1`. 전부 `try/catch` 로 감싸 저장 불가 환경에서도 돈다. 공유 URL 해시가 저장값보다
  우선하고, 구버전 저장값은 `migrateCell` 이 canonical 로 바꿔 기존 링크를 깨뜨리지 않는다.

### js/ 모듈

모듈마다 첫 줄 주석이 담당을 말한다 — 지도는 `head -1 js/*.js` 로 본다. 여기에 표를 따로 두지 않는다(두 곳에 두면
갈라진다). 하나만 짚는다: `qasm.js`(OpenQASM 2.0 ↔ canonical)는 **양방향이 이 파일 하나를 본다.**

## 명령

`node --test` 하나뿐이다(인자 없이 돈다). `package.json` 에 `scripts` 가 없고 ESLint / Prettier / Biome / tsconfig 설정도
없다 — **빌드·린트·포맷 명령은 존재하지 않는다. 지어내지 않는다.** 수동 도구 `node scripts/mutation-control.mjs` 는 새
테스트가 막으려는 실패를 잡는지 메모리 변이로 확인한다(쓰는 법은 파일 머리 주석, 자동으로 돌지 않는다).

**배포도 명령이 아니다.** GitHub Pages 가 `main` 을 그대로 서빙한다(`https://seolwon64.github.io/quantumtools/`) — 빌드
단계가 없어 `main` 푸시가 곧 되돌릴 수 없는 공개 배포다. **커밋과 푸시는 사람이 한다.** 에이전트는 명시적으로 요청받지 않는
한 하지 않는다. 로컬에서는 `index.html` 을 정적으로 서빙하면 그대로 뜬다.

## 테스트 규약

- 러너는 `node:test` 뿐이다. Jest·Vitest·Mocha 도, 러너 설정 파일도 들이지 않는다.
- 파일은 `test/*.test.mjs`, 공유 픽스처는 `test/fixtures-baseline.json`. 전 파일이 `import assert from "node:assert/strict"`,
  소스는 `import { x } from "../js/파일.js"`. `test` 는 기본 임포트(`import test from "node:test"`)가 다수라 새 파일은
  이쪽을 따른다. 명명 임포트를 쓰는 파일도 동작하니 고치러 다니지 않는다.
- **통과 개수를 미리 가정하지 않는다.** 작업 전에 `node --test` 로 기준선을 재고, 끝나면 실패 0 을 확인한다. 통과 수가
  기준선보다 줄었으면 지운 테스트와 그 이유, 다른 곳으로 옮긴 불변식을 보고한다. 개수를 맞추려고 테스트를 만들지 않는다.
- **통과시키려고 단언을 약화시키지 않고, 소스를 고치지도 않는다** — 소스가 틀린 것 같으면 보고한다. 근본 원인이 소스에
  있다고 판단해 고치는 것은 `debugger` 의 일이라 이 금지에 들지 않는다.
- **새 테스트는 그것이 막으려는 실패에서 실패하는지 확인한다.** 옛 코드에 그 실패가 없으면(옛 코드에서도 통과하면) 옛 코드는
  대조군이 못 된다 — `scripts/mutation-control.mjs` 로 디스크를 건드리지 않고 그 실패를 만들어 돌린다.
- Node 에는 DOM·`localStorage`·Three.js 가 없다. 그것들에 기대지 않는 순수 로직만 테스트한다 — `chart.js`·`classical.js`·
  `gatematrix.js` 처럼 DOM 무관하게 짠 모듈이 많은 까닭이다.

## 코드 스타일

- ES 모듈(`"type": "module"`). **주석과 테스트 이름은 한국어**이고, 테스트 이름에는 검사 대상이 아니라 보장을 쓴다.
- `js/*.js` 는 모두 첫 줄에 담당을 한 줄 주석으로 둔다. 새 모듈도 따른다.
- 주석은 "무엇"보다 **"왜"** 를 쓴다 — 과거에 실제로 틀렸던 것과 그때 내린 판단을 남긴다.
- 코드 위치는 줄 번호가 아니라 심볼로 가리킨다. **오래 남는 것(문서·주석·명세)에 적용된다.** 그 자리에서 쓰고 버리는
  보고서(리뷰·감사·디버그 결과)는 줄 번호를 써도 되지만, 실측한 것만 쓰고 추측한 줄 번호는 쓰지 않는다.
- 색·간격·반경을 JS 에 하드코딩하지 않는다. `tokens.js` 의 `token()` / `tokenHex()` / `tokenPx()` 로 CSS 변수를 읽고, **정의는
  `style.css` 한 곳에만** 둔다. 값을 모듈 로드 시점에 캐시하지 않는다(스타일시트가 아직 안 붙었을 수 있다). 규격은 design-spec.

## 커밋 메시지

영어로, **자유 서술형 명령문**으로 쓴다 — 동사 원형으로 시작, 문장형 대문자, 타입 접두사·끝 마침표 없음. 무엇을 했는지보다
**그래서 무엇이 좋아지는지**를 담는다.

```text
Add Inspect mode: simulate measurement collapse for real
Flatten panel chrome so data reads first
Give gates one colour each, and derive connector x from the DOM
```

## 환경

- Node v26.5.0 / Windows (Git Bash). **`jq` 가 없다** — bash 한 줄에 `jq`·`date` 를 쓰지 않는다.
- **Edit / Write** 로 편집하면 PostToolUse 훅(`syntax-check.mjs`)이 문법 오류를 막는다. 거부되면 수정이 깨진 것이니 바로 고친다.
- **Bash 편집(`>>`·`tee`·`sed -i`·heredoc)은 그 훅을 타지 않는다** — matcher 가 도구 이름(`Write|Edit`)이다.
- 그래서 턴 끝 Stop 훅(`run-tests.mjs`)이 `js`·`test`·`.claude/hooks`·`.claude/skills`·`scripts` 의 `.js`/`.mjs`/`.cjs`
  전부에 `node --check` 를 건 뒤 테스트를 돌린다. 하나라도 깨지면 exit 2 로 출력을 돌려보내 턴을 잇는다(되돌리지는 않는다).
- **논리를 바꾸는 Bash 편집은 어느 검사에도 걸리지 않는다** — `sed -i` 로 상수 값을 바꾸면 문법은 멀쩡하다. 파일 편집은
  Edit / Write 로 하고, Bash 로 고쳤다면 `git diff` 로 직접 확인한다.
- InstructionsLoaded 훅(`log-instructions.mjs`)은 지시 파일이 로드될 때 입력을 기록만 한다.

## 명세를 읽어야 하는 조건 — 필요한 것만 읽는다

- **`docs/design-spec.md`** — `style.css`, `index.html`, `js/icons.js`, `js/codepanel.js`, `js/layout.js`, `js/scene.js`,
  `js/grid.js`, `js/gatemenu.js`, `js/popover.js`, `js/playback.js`, `js/probview.js`, `js/chart.js`, `js/tokens.js` 의
  **UI·색상·레이아웃·타이포그래피**를 건드릴 때. 색 토큰, 패널 구조, 게이트 카테고리 색, 인터랙티브 상태, 회로 격자 좌표,
  확률 차트가 여기 있다. 브라우저에서 재거나 검증할 때는 이 문서의 "측정 규칙" 절을 먼저 읽는다.
- **`docs/quantum-spec.md`** — `js/quantum.js`, `js/circuit.js`, `js/trajectory.js`, `js/classical.js`, `js/qasm.js`,
  `js/export.js`, `js/presets.js`, `js/density.js`, `js/probmodel.js`, `js/gatematrix.js` 를 건드릴 때. 회로 데이터 모델,
  게이트 배치와 컨트롤 부착, 측정·궤적, QASM/Qiskit 변환, 직렬화·프리셋이 여기 있다.
- **`js/main.js`·`js/codepanel.js` 는 양쪽에 걸친다** — DOM 배선·렌더링이면 design-spec, 회로 상태 처리나 Apply 의미
  (무엇을 지우고 무엇을 경고하나)면 quantum-spec, 둘 다면 둘 다.
- **`docs/backlog.md`** — 남은 과제와 알려진 규칙 위반. 명세 규칙을 코드에 맞춰 고치고 싶어지면 먼저 본다.

## 서브에이전트

`.claude/agents/` 에 넷이 있다. 절차와 출력 형식은 각 파일에 있다.

| 이름 | 역할 |
|---|---|
| `code-reviewer` | 방금 쓴 코드의 가독성·중복·오류 처리·네이밍 리뷰 (읽기 전용) |
| `security-auditor` | 비밀정보·입력 검증·DOM 싱크·CDN·URL 파라미터 점검 (읽기 전용) |
| `debugger` | 에러·테스트 실패의 근본 원인 추적과 최소 수정 |
| `test-writer` | `test/*.test.mjs` 에 새 테스트 작성 |

## 외부 도구

모두 사용자 범위에 설치한다. 리포의 `.claude/` 에 제3자 파일을 두지 않는다 — Stop 훅이 `.claude/skills` 를 문법 검사하고,
공개 리포에 제3자 코드가 커밋된다.

- **Playwright MCP** — 브라우저 조작과 측정에만 쓰고 `--isolated` 로 띄운다. `@playwright/test`·설정 파일·e2e 테스트를
  리포에 만들지 않는다.
- **Impeccable·Emil Kowalski 스킬** — 디자인 조언이다. `docs/design-spec.md` 와 부딪치면 명세가 이긴다. 스킬 쪽이 옳아
  보이면 조용히 따르지 말고 명세 변경으로 제안한다.
  - Impeccable 은 비평·감사·다듬기 같은 좁은 명령에만 쓴다. **재디자인·새 서피스 흐름(new-work)과 document 는 쓰지 않는다**
    — 둘 다 `DESIGN.md` 에 토큰 값을 쓰고, new-work 는 그걸 완료 조건으로 요구해 우리 테스트와 매 턴 부딪친다. 디자인
    재작성은 Figma 변수 → `style.css` → 명세 경로로 하고 Impeccable 은 그 결과를 비평한다.
  - Impeccable 훅은 안티패턴 결과를 추가 맥락으로만 돌려주고 턴을 막지 않는다. 첫 스캔 때 `.impeccable/hook.cache.json`
    을 만들고 `.git/info/exclude` 에 무시 블록을 더한다.
- `DESIGN.md`·`DESIGN.json`(루트·`.agents/context/`·`docs/`, 대소문자 무관)과 `.impeccable/design.json` 을 리포에 두지
  않고, 그 이름을 다른 용도로도 쓰지 않는다 — `test/ui-invariants.test.mjs` 가 이름만 보고 실패한다.

**설치하지 않는 것**
- `feature-dev`·`pr-review-toolkit`(`code-reviewer` 와), `code-modernization`(`security-auditor` 와) — 이름이 충돌해
  타이프어헤드에 같은 이름이 둘 뜬다.
- Taste(React·Tailwind·framer-motion 을 강제한다), Emil Kowalski 의 `pick-ui-library`(라이브러리 설치를 권한다) — 빌드
  없음·의존성 0 위반.
- TDD Guard — `node:test` 를 지원하지 않고 리포터를 devDependency 로 요구한다.
- Codex 플러그인의 리뷰 게이트 — 켜지 않는다. Stop 훅(`run-tests.mjs`)과 겹친다.