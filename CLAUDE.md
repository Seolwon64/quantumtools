# quantumtools

브라우저에서 전부 도는 양자 회로 시뮬레이터 겸 시각화 도구. 회로에 게이트를 놓으면
상태벡터를 계산해 Bloch sphere(Three.js)·Q-sphere·확률 차트·축소 밀도행렬로 보여주고,
OpenQASM 2.0 / Qiskit 코드와 공유 URL 로 내보낸다. 백엔드도 설치도 없다.

## 아키텍처 결정

**빌드 도구 없음, 런타임 의존성 0.** `package.json` 에 `dependencies` 도
`devDependencies` 도 없다. 번들러 설정이나 npm 패키지 추가를 전제한 제안은 하지 않는다.
브라우저가 `js/*.js` 를 ES 모듈로 직접 로드한다.

**Three.js 는 CDN importmap.** `index.html` 의 `<script type="importmap">` 이 `three` 와
`three/addons/` 를 `https://unpkg.com/three@0.160.0/` 에 매핑한다. 버전을 올리려면 두
항목을 같이 고친다. 폰트(Geist / Geist Mono)는 `fonts/` 에 자체 호스팅하며 CDN 이 아니다.

### js/ 모듈

| 모듈 | 담당 |
|---|---|
| `main.js` | 앱 진입점. DOM 배선과 이벤트 핸들러. 가장 큰 모듈 |
| `circuit.js` | 그리드 회로 컨트롤러 — 상태 계산, 스텝 재생, localStorage 지속성 |
| `quantum.js` | n큐비트 상태벡터 엔진. 게이트 적용, Bloch 벡터, `GATE_INFO` |
| `gatematrix.js` | 배치된 셀 하나의 유니터리 행렬 (읽기 전용, 시뮬레이션 경로와 분리) |
| `density.js` | 축소 밀도행렬·순도·Bloch 벡터 |
| `trajectory.js` | 측정을 실제로 수행해 상태를 붕괴시키는 두 번째 실행 경로 |
| `classical.js` | 지연 측정(deferred measurement) 변환. 순수 함수 |
| `qasm.js` | OpenQASM 2.0 ↔ canonical 회로. **양방향이 이 파일 하나를 본다** |
| `export.js` | 공유 URL 해시 인코딩(base64url), QASM / Qiskit 코드 생성 |
| `codepanel.js` | QASM / Qiskit 코드 패널 |
| `presets.js` | 회로 프리셋 |
| `scene.js` | Three.js Bloch sphere 렌더링, Slerp 상태 벡터 애니메이션 |
| `chart.js` | 확률 막대 차트의 축·라벨 배치. DOM 무관한 순수 로직 |
| `tokens.js` | 디자인 토큰을 JS 에서 읽는 단일 창구 |
| `icons.js` | 아이콘 세트 (Lucide, ISC) |
| `layout.js` | 워크스페이스 리사이즈 스플리터 |
| `menu.js` | 햄버거 메뉴 드로어 |

### 상태와 지속성

프레임워크 없음. `circuit.js` 의 `createCircuitController({ onChange, onAnimateStep,
onStepPause, initial })` 가 회로 상태를 소유하고 콜백으로 알린다. `main.js` 가 그
콜백에서 DOM 을 갱신한다.

지속성은 `localStorage` 네 키 — `bloch-composer-v1`(회로), `bloch-layout-v3`(패널 크기),
`bloch-code-panel-v1`, `bloch-prob-view-v1`. 전부 `try/catch` 로 감싸 저장 불가 환경에서도
동작한다. 공유 URL 해시가 있으면 저장값보다 우선한다. 구버전 저장값은 `migrateCell` 로
canonical 형태로 변환해 기존 링크를 깨뜨리지 않는다.

## 명령

```bash
node --test
```

테스트 러너. 인자 없이 돈다.

**이게 전부다.** `package.json` 에 `scripts` 필드 자체가 없고, ESLint / Prettier /
Biome / tsconfig 설정 파일도 없다. **빌드·린트·포맷 명령은 존재하지 않는다** — 없는
명령을 지어내지 말 것.

배포도 명령이 아니다. GitHub Pages 가 `main` 브랜치를 그대로 서빙한다
(`https://seolwon64.github.io/quantumtools/`). 빌드 단계가 없으니 `main` 에 푸시하면
그게 배포다. 로컬에서는 `index.html` 을 정적으로 서빙하면 그대로 뜬다.

그래서 `main` 푸시는 되돌릴 수 없는 공개 배포다. 커밋과 푸시는 사람이 한다 —
에이전트는 명시적으로 요청받지 않는 한 하지 않는다.

## 테스트 규약

- Jest, Vitest, Mocha 를 도입하지 않는다. 러너 설정 파일도 만들지 않는다.
- 파일은 `test/*.test.mjs`. 공유 픽스처는 `test/fixtures-baseline.json`.
- `import assert from "node:assert/strict"` — 전 파일 공통.
- `test` 는 **기본 임포트**(`import test from "node:test"`)가 다수다. 새 파일은 이쪽을
  따른다. 일부 파일이 명명 임포트를 쓰는데 둘 다 동작하므로 고치러 다니지 않는다.
- 소스는 `import { x } from "../js/파일.js"` 로 가져온다.
- **통과 개수를 미리 가정하지 않는다.** 작업 전에 `node --test` 를 한 번 돌려 기준선을
  재고, 작업 후 통과 수가 기준선 이상이고 실패가 0인지 확인한다.
- 통과시키려고 단언을 약화시키지 않는다. 소스가 틀린 것 같으면 고치지 말고 보고한다.
- 브라우저 API(DOM, `localStorage`, Three.js)는 Node 에 없다. 그것들에 의존하지 않는
  순수 로직만 테스트한다. `chart.js`, `classical.js`, `gatematrix.js` 처럼 DOM 무관하게
  짜인 모듈이 많은 것이 그래서다.

## 코드 스타일

- ES 모듈. `package.json` 에 `"type": "module"`.
- **주석과 테스트 이름은 한국어.** 테스트 이름에는 무엇을 검사하는지가 아니라 무엇이
  보장되는지를 쓴다.
- `js/*.js` 는 첫 줄에 그 모듈이 무엇을 담당하는지 한 줄 주석을 둔다. 새 모듈도 이
  관례를 따른다. `main.js` 에만 없는데 이는 관례의 예외가 아니라 누락이며, 손댈 일이
  있을 때 채운다.
- 주석은 "무엇"보다 **"왜"** 를 쓴다. 과거에 실제로 틀렸던 것과 그때 내린 판단을
  남겨두는 식이다.
- 코드 위치는 줄 번호가 아니라 심볼로 가리킨다.
- 색·간격·반경을 JS 에 하드코딩하지 않는다. `tokens.js` 의 `token()` / `tokenHex()` 로
  CSS 변수에서 읽고, **정의는 `style.css` 한 곳에만** 둔다. 값을 모듈 로드 시점에
  캐시하지 않는다 — 스타일시트가 아직 적용되기 전일 수 있다. 자세한 규격은 설계 명세.

## 커밋 메시지

영어로 쓴다. 기존 스타일은 **자유 서술형 명령문**이다 — 동사 원형으로 시작, 문장형
대문자, 타입 접두사 없음, 끝에 마침표 없음.

```text
Add Inspect mode: simulate measurement collapse for real
Flatten panel chrome so data reads first
Give gates one colour each, and derive connector x from the DOM
```

무엇을 했는지보다 **그래서 무엇이 좋아지는지**를 담는 편이다. 최근 커밋 하나가
Conventional Commits(`feat(agents): ...`)를 쓰지만 소수이므로, 지배적인 자유 서술형에
맞춘다.

## 환경

- Node v26.5.0 / Windows (Git Bash).
- **`jq` 가 없다.** bash 한 줄에 `jq` 나 `date` 를 쓰지 말 것.
- 파일을 편집하면 문법 검사 훅이 돌아 문법 오류를 차단한다. 훅이 거부하면 수정이 깨진
  것이니 바로 고친다.

## 명세를 읽어야 하는 조건

명세는 둘로 나뉜다. 필요한 쪽만 읽는다.

**`docs/design-spec.md`** — `style.css`, `index.html`, `js/icons.js`, `js/menu.js`,
`js/layout.js`, `js/scene.js` 의 **UI·색상·레이아웃·타이포그래피**를 건드릴 때.
색 토큰 규격, 패널 구조, 게이트 팔레트의 버튼 치수·카테고리 색, 확률 차트 렌더링이
여기 있다.

**`docs/quantum-spec.md`** — `js/quantum.js`, `js/circuit.js`, `js/trajectory.js`,
`js/classical.js`, `js/qasm.js`, `js/export.js`, `js/presets.js`, `js/density.js` 를
건드릴 때. 회로 데이터 모델, 게이트 배치와 컨트롤 부착, 측정·궤적, QASM/Qiskit 변환,
직렬화·프리셋이 여기 있다.

**`js/main.js` 는 양쪽에 걸친다.** DOM 배선·렌더링을 고치면 design-spec, 회로 상태
처리를 고치면 quantum-spec 을 읽는다. 둘 다면 둘 다 읽는다.

둘은 원본 한 파일을 분할한 것이라 아직 중복이 남아 있다. 각각 50KB 안팎이니 필요한
쪽만 읽는다.

## 서브에이전트

`.claude/agents/` 에 넷이 있다. 절차와 출력 형식은 각 파일에 있으므로 여기서는 무엇이
있는지만 적는다.

| 이름 | 역할 |
|---|---|
| `code-reviewer` | 방금 쓴 코드의 가독성·중복·오류 처리·네이밍 리뷰 (읽기 전용) |
| `security-auditor` | 비밀정보·입력 검증·DOM 싱크·CDN·URL 파라미터 점검 (읽기 전용) |
| `debugger` | 에러·테스트 실패의 근본 원인 추적과 최소 수정 |
| `test-writer` | `test/*.test.mjs` 에 새 테스트 작성 |

## 설치하지 않는 플러그인

이름이 충돌해 타이프어헤드에 같은 이름이 둘 뜬다.

- `feature-dev`, `pr-review-toolkit` — `code-reviewer` 충돌
- `code-modernization` — `security-auditor` 충돌