# js/main.js 분해 계획

`js/main.js`(분해 전 2,571줄 / 117KB)를 일곱 파일로 나눈다. 이 문서는 조사 결과와
단계별 실행 계획이다. **0~4단계까지 끝나 main.js 는 1,628줄 / 74KB 다. 다음은 5단계다.**
아래 1부의 수치는 분해 전 기준이다.

> 위치 표기는 줄 번호가 아니라 심볼로 한다(CLAUDE.md 코드 스타일). 이 문서는 오래
> 남으므로 그 규칙이 적용된다.

## Context — 왜 계획을 먼저 세우는가

이 리포에서 가장 위험한 작업이다.

- `main.js` 가 `js/` 전체 300KB 중 117KB(39%)다.
- DOM 배선이라 **232개 테스트가 거의 덮지 않는다.** 안전망이 가장 얇다.
- 커밋 `683d624` 가 `js/*.js` 17개를 하위 디렉터리로 옮기면서 임포트를 안 고쳐 앱과
  테스트를 전부 죽였다(`754f8d4` 가 되돌렸다). 같은 실수를 반복할 여지가 크다.

계획 없이 시작하면 중간에 구조가 틀렸다는 걸 알게 되고, 그때는 되돌리기 어렵다.

---

# 1부 · 조사 결과

## A. 콜백 소유권

`createCircuitController({ onChange: render, onAnimateStep: runStepTransition,
onStepPause: () => delay(stepPause()) })`

### `render` 가 부르는 것

| 호출 대상 | 덩어리 |
|---|---|
| `probSignature` · `probDisplay` · `scheduleAggregate` · `renderProbabilities` | chart |
| `cellAtHome` · `renderGateInfo` · `markSelection` | gatemenu |
| `applySphereModeUI` · `updatePaletteAvailability` · `buildCircuitGrid` · `buildQubitTabs` · `renderDensityMatrix` · `renderStateFormula` · `setPlaybackDisabled` | rest |

여기에 `scene.setVectorInstant`/`setQSphereData`, `codePanel.onCircuitChanged()`,
`icon()` 호출과 **DOM 직접 조작 20여 곳**이 섞여 있다. `render` 는 네 덩어리를 **모두**
건드린다.

### `runStepTransition` 이 부르는 것

`probDisplay` · `buildProbTween`(chart), `stepIndicatorX` · `setStepIndicator` ·
`highlightColumn` · `easeInOutCubic` · `stepDuration`(playback), 그리고 `scene.*` ·
`probList` · `sphereMode` · `circuit`.

### `onStepPause` 는 성격이 다르다

다른 둘은 DOM 을 갱신하지만 이것은 **시간만 흘려보낸다.** DOM 도 스냅샷도 안 본다.
상수 둘(`STEP_DURATION`, `STEP_PAUSE`)과 `reducedMotion` 에만 의존하므로 분해에서
가장 자유롭다 — 진입점에 인라인으로 남겨도 된다.

### 쪼갠 뒤 누가 콜백을 받는가 — 판단이 갈리는 지점

**선택지 1 — 진입점이 계속 받아 분배 (권고)**

- 대가: 진입점이 얇아지지 않는다. 렌더 순서가 하드코딩되고 새 모듈마다 진입점을 고친다.
- 이득: **렌더 순서가 한 곳에 보인다.** `render` 에는 지켜야 할 순서 제약이 셋 있다:
  1. `buildCircuitGrid` → 패널 `min-height`(그리드의 `scrollHeight` 를 읽는다)
  2. `scheduleAggregate` → `renderProbabilities`
  3. 선택 무효화(`selectedGate`/`infoTarget`) → `renderGateInfo`

  구독 방식으로 흩으면 이 순서가 **등록 순서라는 암묵적 계약**이 되어 보이지 않는다.

**선택지 2 — 각 모듈이 자기 구독을 등록**

- 대가: `circuit.js` 에 구독자 배열을 추가해야 한다. **컨트롤러는 232개 테스트가 두껍게
  덮는 유일한 부분**이다. 안전망 있는 곳을 건드려 없는 곳을 정리하는 셈이라 방향이 반대다.
- 이득: 모듈이 자족적이라 진입점이 얇아진다.

**권고: 선택지 1.** 순서 제약이 실재하고 컨트롤러를 안 건드려도 되기 때문. 다만
"진입점이 두꺼워도 되는가"에 달린 판단이라 **취향이 갈릴 수 있다.** 분배 함수가 40줄을
넘으면 재검토할 지점.

## B. 응집 덩어리 — 시사된 넷이 실제로 갈린다

최상위 심볼 184개의 참조 그래프로 확인했다.

| 덩어리 | 심볼 | 줄 수 | → 밖으로 | ← 안으로 |
|---|---|---|---|---|
| chart | 21 | ~477 | **18** | 5 |
| popover | 13 | ~398 | **7** | 7 |
| gatemenu | 16 | ~366 | **22** | 5 |
| playback | 13 | ~78 | 7 | 6 |
| rest | 121 | ~1229 | 18 | 36 |

### chart
시작점 넷 외에 `probDisplay` · `barTooltipHTML` · `showChartTooltip`/`hideChartTooltip`/
`chartTooltip` · `svgEl` · `topRoundedRect` · `SVGNS` · `CHART` · `makeShowAllButton`,
그리고 **샘플링 일체**(`runSampling`, `resetSampling`, `sampleAsync`,
`sampleTrajectories`, `probSignature`, `aggregateSignature`, `clampShots`).

→ `circuit` · `render` · `probList` · `probFooter` · `runBtn` · `shotsInput` ·
`resetShotsBtn` · `endianLabelText` + **가변 상태 9개**.
← `renderProbabilities` · `probDisplay` · `buildProbTween` · `probSignature` ·
`scheduleAggregate`.

### popover
`openPlacePopover` · `openControlPopover` · `openBitPopover` 와 래퍼 셋
(`openConditionPopover`, `openMeasureBitPopover`, `openRemoveControlPopover`) ·
`openParamEditor` · `buildSliderRows` · `showPopoverAt` · `closePlacePopover` ·
`popoverOpen` · `radToDegRound` · `pendingPlacement`.

→ **7개뿐**: `placePopover` · `scene` · `circuit` · `render` · `showToast` ·
`standardGateName` · `homeOf`. **가장 먼저 떼기 좋다.**

### gatemenu
메뉴(`openGateMenu`, `closeGateMenu`, `menuIndex`, `MENU_ICONS`, `gateMenuOpen`,
`openMenuForCell`) + **게이트 정보 패널**(`renderGateInfo`, `buildMatrixGrid`,
`openGateInfo`, `closeGateInfo`, `formatAngle`, `PI_FRACTIONS`, `radToDeg`) +
선택 헬퍼(`markSelection`, `cellAtHome`, `homeOf`).

→ **22개로 가장 많다**: 상태 셋(`selectedGate`, `infoTarget`, `expandedInfo`), DOM 다섯
(`gatePalette`, `gateInfoEl`, `gateInfoClose`, `paletteTitle`, `gateMenu`), `menu` ·
`scene` · `circuit` · `showToast` · `showTooltip`/`hideTooltip`, **popover 함수 다섯**.

### playback
가장 작다. `runStepTransition` + 인디케이터 셋(`stepIndicatorX`, `setStepIndicator`,
`highlightColumn`) + 타이밍 상수·헬퍼.

### 네 덩어리에 안 들어가는 나머지 (~1229줄)
DOM 핸들 52개, 팔레트(`buildPalette`, `makeGateChip`, `PALETTE_CATEGORIES`,
`PALETTE_GLYPHS`, `GATE_CATEGORY`, `updatePaletteAvailability`, `attachGateHover`),
**`buildCircuitGrid`(단일 함수 290줄 — 최대)**, 툴팁(`showTooltip`, `hideTooltip`,
`showTransientTip`, `gateTooltip`), 밀도행렬 뷰(`renderDensityMatrix`,
`buildDmQubitTabs`, `fmt3`, `fmtComplexCell`), 상태 수식(`renderStateFormula`,
`formatAmplitude`), 구 모드(`setSphereMode`, `applySphereModeUI`, `updateBlochInfo`),
토스트·공유, 프리셋 드롭다운, 코드패널 배선, `render`, 이벤트 등록 전부.

## C. 공유 상태 — 교차하는 것이 12개

| 변수 | 선언 | 쓰는 곳 | 읽는 곳 |
|---|---|---|---|
| `aggregate` · `aggregateBatch` · `aggregateTimer` | rest | **chart** | chart |
| `sampleResult` | rest | chart, **rest** | chart |
| `sampling` | rest | **chart** | rest |
| `probShowAll` | rest | chart | chart |
| `probView` · `hideZeroProb` | rest | rest | **chart** |
| `selectedGate` · `infoTarget` · `expandedInfo` | rest | gatemenu, **rest** | gatemenu |
| `sphereMode` | rest | rest | **playback**, rest |
| `stepIndicatorEl` · `highlightedCol` | playback | **rest**, playback | playback |
| `pendingPlacement` · `menuIndex` · `transientTipTimer` · `toastTimer` | 각자 | 자기만 | — |

### 처리 방침

1. **한 덩어리가 온전히 소유** — `aggregate`, `aggregateBatch`, `aggregateTimer`,
   `sampleResult`, `sampling`, `probShowAll` 은 chart 가 쓰고 읽는다. chart 로 옮기고
   필요한 것만 접근자로 낸다. **접근자가 하나면 된다고 적었던 것은 틀렸다** — 4단계
   실측으로 넷이 필요했다: `isSampling`(`runBtn.disabled` + Run 라벨) ·
   `getAggregate`(`probDisplay` 두 호출부) · `invalidateStaleSample`(`render` 첫 줄) ·
   `clearSample`(`probView` 토글 핸들러).
2. **진입점이 소유하고 인자로 전달** — `probView`(localStorage 연동)·`hideZeroProb` 는
   사용자 설정. `probDisplay(snapshot, { probView, aggregate })` 형태. E 의 순수 함수
   분리와 직결된다.
3. **UI 선택 상태** — `selectedGate`·`infoTarget`·`expandedInfo` 는 gatemenu 가 소유하고
   `gatemenu.invalidate(snapshot)` 을 진입점이 부른다.

`stepIndicatorEl`·`highlightedCol` 은 playback 소유인데 **`buildCircuitGrid`(rest)가
쓴다** — 그리드를 다시 지으면 인디케이터 엘리먼트가 새로 생기기 때문. 분해 후에도 남는
결합이라 `playback.attachTo(gridEl)` 같은 재등록 함수가 필요하다.

### snapshot 이중화 — `inspectOn` 하나뿐

`inspectOn` 은 `circuit.js` 의 `inspectMode` 를 미러링하며 토글 핸들러 안에서만 쓰인다.
`render` 는 이미 `snapshot.inspectMode` 를 본다. **다른 이중화는 없다** — `sphereMode` ·
`probView` · `hideZeroProb` 는 스냅샷에 없는 순수 뷰 상태이고, `highlightedCol` 은 중복
DOM 쓰기를 막는 캐시이지 진실의 복제가 아니다.

## D. DOM 참조

- `getElementById` **79회 / 고유 id 78개**, `querySelector(All)` 14회.
- 같은 id 를 두 번 잡는 곳은 **`workspace` 하나**(최상위 `const` + `codePanel` 배선).
- 최상위 `const` 로 **52개 캐시**, 나머지 약 27회는 함수 안에서 조회.

**소유 배분(권고)**: `placePopover` → popover / `gateMenu`·`gateInfoEl`·
`gateInfoClose`·`paletteTitle` → gatemenu / `probList`·`probFooter`·`probSampling`·
`shotsInput`·`runBtn`·`resetShotsBtn`·`probHideToggle`·`probHideZeros`·
`probViewToggle`·`probEndian` → probview / 나머지 → 진입점.

**주의**: 최상위 `const` 는 모듈 로드 시점에 즉시 `getElementById` 를 실행한다. 쪼개면
**import 순서가 곧 실행 순서**가 된다 → 위험 지점 2번으로 이어진다.

## E. 테스트 가능성

DOM 을 안 건드리는 최상위 함수 22개(286줄)를 찾았으나, 일부는 DOM 헬퍼를 호출해
전이적으로 오염된다(`openConditionPopover`, `openMeasureBitPopover`,
`scheduleAggregate`, `showTransientTip`, `updatePaletteAvailability`).

**진짜 순수 후보**

| 함수 | 줄 | 조건 |
|---|---|---|
| `probDisplay` | 35 | `probView`·`aggregate` 를 **인자로 받으면** 순수 |
| `barTooltipHTML` | 29 | `sampleResult` 를 **인자로 받으면** 순수 — 3단계에서 정정 |
| `standardGateName` | 18 | 이미 순수 |
| `formatAmplitude` | 16 | 이미 순수 |
| `stackGlyph` | 10 | 이미 순수 |
| `aggregateSignature` · `homeOf` · `cellAtHome` · `formatAngle` · `topRoundedRect` · `radToDegRound` · `clampShots` · `probSignature` | 3~9 | 이미 순수 |

**`probDisplay` 하나는 뺄 가치가 확실하다.** Classical/Qubits 분기, 궤적 유무에 따른
이론값 vs 집계값 선택, 엔디언 라벨, 축 제목을 정하는 **표시 정책의 핵심**인데 테스트가
0이다. quantum-spec §6 의 계약(`고전 비트 막대에는 진폭도 위상도 없다` → `re: null`)이
여기 구현돼 있다.

**`chart.js` 선례가 그대로 적용된다.** `chart.js` 는 `pickLabelMode`/`niceTickStep`/
`phaseInfo` 를 DOM 없이 빼서 `chart.test.mjs` 가 검증한다. 나머지 잔챙이 순수 함수는
옮기는 비용이 얻는 것보다 크다.

## F. 순환 참조 위험 — 두 곳

**1. gatemenu ↔ popover (실재)**
gatemenu → popover: `openControlPopover`, `openConditionPopover`,
`openMeasureBitPopover`, `openRemoveControlPopover`, `openParamEditor` **다섯**.
popover → gatemenu: **`homeOf` 하나뿐**(`openConditionPopover`·`openMeasureBitPopover`).

→ **해소**: `homeOf` 와 `cellAtHome` 은 스냅샷만 읽는 순수 조회 함수다. 공용 자리로
옮기면 역방향 간선이 사라진다.

**2. 모든 덩어리 ↔ 진입점 (구조적)**
네 덩어리가 전부 `circuit`·`scene`·`render`·`showToast` 를 참조하는데 이들은 진입점에
있다. 진입점이 다시 네 덩어리를 import 하면 전부 순환.

→ **해소**: 덩어리를 **팩토리 함수로 만들어 의존을 주입**한다
(`initProbView({ circuit, els, onNeedRender })`). **`codepanel.js` 가 이미 이 패턴이다**
(`initCodePanel({ circuit, scene, showToast, onOpen, els })`). 리포에 선례가 있으므로
새 패턴을 들이는 것이 아니다.

---

# 2부 · 실행 계획

## 1. 분해 후 파일 목록

기존 명명(소문자 한 단어)에 맞춘다. **모두 `js/` 평면에 둔다** — 하위 디렉터리를 만들지
않는다(683d624 가 그 시도였다).

| 파일 | 담당 | 예상 줄 수 |
|---|---|---|
| `js/main.js` | 진입점. DOM 핸들, 팔레트, 툴팁, 밀도행렬 뷰, 상태 수식, 구 모드, 토스트·공유·프리셋, `render` 분배, 이벤트 등록 | ~900 |
| `js/grid.js` | `buildCircuitGrid` + `gridCenter` · `cellAt` · `CIRCUIT_CHROME` | ~330 |
| `js/probview.js` | 확률 차트 + 샘플링·집계 | ~480 |
| `js/popover.js` | 배치·컨트롤·비트·파라미터 팝오버 전부 | ~400 |
| `js/gatemenu.js` | 컨텍스트 메뉴 + 게이트 정보 패널 + 선택 표시 | ~370 |
| `js/playback.js` | 스텝 전환 트윈 · 인디케이터 · 타이밍 | ~90 |
| `js/probmodel.js` | `probDisplay` · `barTooltipHTML` — **DOM 무관 순수 로직** | ~70 |

> **결정 — `probmodel.js` 를 별도 파일로 둔다.** 근거 둘. (1) `chart.js` 는 "축·라벨
> 배치"라는 좁은 책임이고 `probDisplay` 는 "무엇을 표시할지 고르는" 다른 층이다.
> (2) `chart.js` 는 2KB 에 테스트가 스무 개쯤 붙어 있는데, 다른 책임을 섞으면 **그
> 테스트들이 무엇을 보장하는지가 흐려진다.** `chart.js` 가 좁은 책임으로 남는 것이
> 그 테스트의 가치다.

## 2. 단계 분할 — 6단계

각 단계가 끝날 때 `node --test` 통과 + 앱이 뜨는 상태여야 한다.
**순서 원칙: 밖으로 나가는 의존이 적은 것부터.**

| 단계 | 옮기는 것 | 근거 |
|---|---|---|
| **0** | `homeOf`·`cellAtHome` 을 **`circuit.js`** 로 이동 + `menu.test.mjs` 정규식 목록화 | F-1 순환을 **먼저** 끊는다. 이후 모든 단계가 여기 의존한다 |
| **1** | `popover.js` | 밖으로 나가는 의존 7개로 가장 적다. 팩토리 패턴을 여기서 처음 시험한다 |
| **2** | `playback.js` | 78줄로 가장 작다. `stepIndicatorEl` 결합을 `attachTo` 로 푼다 |
| **3** | `probmodel.js`(순수) **+ 테스트 추가** | 옮기기 전에 안전망을 만든다 |
| **4** | `probview.js` | 3단계 테스트가 표시 정책을 지켜준다 |
| **5** | `gatemenu.js` | 의존이 가장 많다. 앞 단계가 끝나야 대상이 준다. **개수는 착수 전에 다시 센다 — 아래 주** |
| **6** | `grid.js` | 290줄. `stepIndicatorEl` 생성이 playback 과 얽혀 마지막 |

> **5단계 착수 전에 참조를 직접 세어 이 표와 B 절을 정정한다.** B 절의 "gatemenu 의존
> 22개"는 **지금 틀렸다** — 0단계가 `homeOf`·`cellAtHome` 을, 1단계가 popover 함수
> 다섯을 이미 가져갔다. 세어 보기 전에는 몇 개인지 적지 않는다.
>
> 4단계가 선례다. 계획의 "18개"가 실측 9개였다. 조사 판정이 네 번 틀렸으므로
> (1단계 `render` 의존 0 · 2단계 배선 순서 정반대 · 3단계 `barTooltipHTML` 순수성 ·
> 4단계 의존 개수와 접근자 수) **목록을 믿지 말고 참조를 따라가라.**

### 0단계 — 목적지는 `circuit.js` 다

`homeOf` 와 `cellAtHome` 을 `circuit.js` 로 옮긴다. 둘 다 스냅샷만 읽는 순수 조회
함수이고, **스냅샷을 소유한 것이 `circuit.js`** 다. 덤으로 테스트를 붙일 수 있는 자리가
된다(지금은 main.js 에 있어 테스트가 0이다).

**A 절이 선택지 2를 기각한 근거와 충돌하지 않는다.** 거기서 "`circuit.js` 는 232개
테스트가 두껍게 덮는 유일한 곳이니 건드리지 마라"고 한 것은 **구독자 배열을 추가해 기존
알림 동작을 바꾸는 일**을 두고 한 말이다. 이번 것은 **순수 추가**다 — 기존 코드 경로를
하나도 바꾸지 않으므로 기존 테스트가 깨질 수 없다. 바꾸는 것과 더하는 것은 위험이 다르다.

같은 단계에서 **`test/menu.test.mjs` 를 읽어 소스 텍스트를 검사하는 정규식을 전부
목록화한다.** 위험 4번이 `menu.setAction("code", ...)` 하나만 짚었지만 다른 문자열도
검사할 수 있다. 1단계를 시작하기 전에 무엇이 걸려 있는지 알아야 한다.

**3단계를 4단계 앞에 둔 것이 이 계획의 핵심이다.** main.js 는 테스트가 없으므로,
옮기기 전에 **옮길 대상의 일부에 테스트를 먼저 붙인다.**

### 3단계 — `probmodel.js` 와 첫 회귀 테스트

**계약의 출처는 `docs/quantum-spec.md` §6 이다.** 옮기기 전에 현재 구현이 §6 과 맞는지
먼저 대조했다(아래 "명세 대조"). 어긋난 것이 없어야 진행한다.

#### 옮기는 것 셋

| 심볼 | 왜 같이 가는가 |
|---|---|
| `probDisplay` | 3단계의 본체. 표시 정책의 핵심인데 테스트가 0이다 |
| `barTooltipHTML` | `probDisplay` 가 만든 `re: null` 을 **읽는 쪽**이다. §6 의 "진폭·위상 행을 뺀다"는 두 함수에 걸쳐 성립하므로 한 파일에서 같이 검증해야 계약이 닫힌다 |
| `endianLabelText` | `probDisplay` 가 부른다. 두 줄짜리 순수 함수라 복제하지 않고 옮긴 뒤 main.js 가 다시 import 한다 |

`endianLabelText` 는 `probDisplay` 밖에서도 한 곳(`render` 의 `probEndian.textContent`)이
쓴다. 그래서 **옮기고 되가져온다** — 복제하면 엔디언 표기가 두 곳에서 갈릴 수 있다.

#### 시그니처 — 세 결정과 근거

원칙은 하나다. **호출부에서 바뀌는 글자 수를 최소로 하되, 모듈 최상위 가변 상태를 읽는
경로는 남기지 않는다.** 하나라도 남으면 Node 에서 import 되지 않아 3단계의 목적이 사라진다.

**1. `probDisplay(snapshot, { probView, aggregate })`** — 위치 인자 둘이 아니라 객체로 받는다.
호출부가 `{ probView, aggregate }` 축약형이 되어 **옮기기 전 코드와 글자가 같아지고**,
읽는 사람이 인자 순서를 외울 필요가 없다. 계획 C-2 가 예고한 형태 그대로다.

**2. `barTooltipHTML(entry, sample, view)`** — 둘째 인자를 불리언 `sampled` 에서
**`sampleResult` 객체 또는 `null`** 로 바꾼다.

> 계획 E 절이 이 함수를 "이미 순수"라고 적었는데 **틀렸다.** 최상위 `sampleResult` 를
> 직접 읽는다(`sampleResult.counts` · `sampleResult.shots`). 불리언 `sampled` 는 사실상
> "지금 `sampleResult` 를 봐도 되는가"의 대리값이었다. 객체를 그대로 넘기면 두 사실이
> 하나로 합쳐지고 최상위 읽기가 사라진다. 인자 **개수와 순서는 그대로**다.

호출부는 `barTooltipHTML(entry, sampled, view)` → `barTooltipHTML(entry, sampled ? sampleResult : null, view)`
한 곳뿐이다. `sampled` 변수 자체는 `renderProbabilities` 의 다른 두 곳이 계속 쓰므로 남긴다.

**3. `endianLabelText(n, prefix = "q")`** — 그대로. 순수하다.

#### 호출부 — 네 곳

| 위치 | 변경 |
|---|---|
| `renderProbabilities` 의 `probDisplay(snapshot)` | 둘째 인자 추가 |
| `render` 의 `probDisplay(snapshot)` | 둘째 인자 추가 |
| `renderProbabilities` 의 `barTooltipHTML(entry, sampled, view)` | 둘째 인자 표현식 교체 |
| `initPlayback({ ..., probDisplay, ... })` | `probDisplay: (s) => probDisplay(s, { probView, aggregate })` |

넷째가 **`js/playback.js` 를 손대지 않는 이유**다. playback 은 주입받은 함수를 인자 하나로
부를 뿐이므로, main 쪽에서 화살표로 감싸면 playback 파일은 한 글자도 바뀌지 않는다.
화살표 안에서 `probView`·`aggregate` 를 **호출 시점에** 읽으므로 값이 굳지도 않는다.

#### import 이동

`phaseInfo`(chart.js)와 `marginalClassical`(trajectory.js)은 **옮기는 세 함수 안에서만**
쓰인다(각각 1회). 따라서 두 이름은 main.js 의 import 에서 빠지고 `probmodel.js` 로 간다.
`pickLabelMode`·`niceTickStep` 은 main.js 에 남는다.

둘 다 이미 Node 에서 import 되는 모듈이라(`chart.test.mjs` · `trajectory.test.mjs`)
`probmodel.js` 도 DOM 없이 뜬다.

#### 옮기는 방법 — 1·2단계와 같다

스크래치패드의 Node 스크립트가 줄 범위를 잘라 붙인다. **경계 줄의 내용을 먼저 단언하고
어긋나면 아무것도 하지 않는다.** 원문을 다시 타이핑하지 않는다.

옮기는 블록 안에서 바꾸는 것은 **다섯 군데뿐**이며 스크립트가 명시적으로 치환한다:
`probDisplay` 서명 1 · `barTooltipHTML` 서명 1 · `if (sampled)` 1 · `sampleResult.` 2.
그 외 한 줄도 바뀌지 않아야 하고, 옮긴 뒤 원문 포함 여부로 확인한다.

#### `test/probmodel.test.mjs` — 19개

`test/chart.test.mjs` 의 명명과 스타일을 그대로 따른다(기본 임포트 `test`,
`node:assert/strict`, 한국어 이름, **무엇이 보장되는지**를 쓴다).

스냅샷은 리터럴로 만든다 — `probDisplay` 가 읽는 필드는 `hasMeasurement` ·
`usesTrajectory` · `probabilities` · `qubitCount` · `clbitCount` · `grid` 여섯뿐이다.

| 묶음 | 보장 |
|---|---|
| 분기 | 측정이 없으면 토글과 무관하게 큐비트 분포 / 측정이 있으면 `probView` 가 고른다 |
| 궤적 vs 이론 | 큐비트는 `qubitProbs` **평균**을 쓴다 / 고전은 `classical` 을 그대로 쓴다 / 궤적이 없으면 `marginalClassical` 과 **정확히** 같다 / `usesTrajectory` 여도 `aggregate` 가 아직 없으면 이론값 |
| 고전 막대 계약 | 고전 항목은 `re`·`im` 이 `null` / 툴팁이 그 행을 **뺀다** / 큐비트 항목은 두 행을 낸다 |
| 툴팁 | 축이 shots 면 `Estimated`, 아니면 `Theoretical` / `sample` 이 있으면 관측 행이 붙는다 |
| 엔디언 | q0 가 오른쪽 끝 / 접두사가 모드를 드러낸다(q vs c) |
| 축 제목 | shots 수를 밝혀 집계값과 이론값을 섞어 읽지 않게 한다 |
| 경계 | 0비트 `\|⟩` · 1비트 / `probabilities` 가 비어도 던지지 않는다 / `clbitCount` 0 이면 막대 하나 / 고전 라벨은 `clbitCount` 자리를 다 채운다 |
| 길이 불일치 | 짧은 `aggregate.qubitProbs` 는 **걸러지지 않고 NaN 이 그대로 나온다** |

마지막 항목은 **버그를 옳다고 굳히는 것이 아니라 책임 소재를 적는 것**이다. 5절 Warning 1이
지목한 대로 원인은 `scheduleAggregate` 에 있고, 4단계 커밋 후에 고친다. 테스트 이름에
"호출자 책임"을 적어 4단계 수정 때 이 테스트를 함께 고칠 것을 알린다.

#### 명세 대조 — §6 다섯 조항 전부 일치

| §6 조항 | 구현 | 판정 |
|---|---|---|
| Classical 은 비트열을 **센다** | `aggregate.classical` | 일치 |
| Qubits 는 확률을 **평균**한다(샘플링 아님) | `aggregate.qubitProbs` | 일치 |
| 궤적이 필요 없으면 이론 주변화 | `marginalClassical` | 일치 |
| 고전 막대에 진폭·위상 없음 | `re: null` → 툴팁이 행을 뺀다 | 일치 |
| 표시 필터는 DOM 무관 순수 함수 | 3단계가 이것을 **참으로 만든다** | — |

**어긋난 것은 없다. 진행한다.**

명세가 말하지 않는 자리 하나는 적어 둔다. `usesTrajectory` 인데 `aggregate` 가 아직
`null` 인 150ms 동안 고전 분포는 주변화로 그려지는데, 중간 붕괴가 있는 회로에서 주변화는
정확하지 않다. 다만 축이 `Probability (%)`(shots 없음)라 **집계값인 척하지 않으므로**
위반이 아니라 명세가 다루지 않는 과도 상태다. 이번에 고치지 않는다.

### 4단계 — `probview.js` (실행 결과)

옮긴 것은 B 절 chart 덩어리에서 3단계가 가져간 셋을 뺀 나머지 **전부**다. 참조를 직접
따라가 확정했고, 계획서와 어긋난 곳이 셋 있었다.

**계획과 달랐던 것 셋**

1. **접근자 하나 → 넷.** 위 C-1 에 정정해 두었다.
2. **`chartTooltip` 이 최상위 부수효과였다.** 위험 2번은 "DOM 핸들 52개"만 짚었는데,
   차트 툴팁은 `document.createElement` + `document.body.appendChild` 를 로드 시점에
   실행한다. `initProbView` 안으로 옮기면서 **`const` 를 대입으로 바꿔야 한다** —
   그대로 두면 init 지역 변수가 모듈 변수를 가려 툴팁이 영원히 `undefined` 다.
   문법 검사도 테스트도 못 잡는다(실제로 한 번 그렇게 만들었다가 되돌렸다).
3. **밖으로 나가는 의존은 18개가 아니라 9개다** — `circuit` · `render` · `probView` ·
   `hideZeroProb` · DOM 다섯. 3단계가 `probDisplay`·`barTooltipHTML`·`endianLabelText`
   를 이미 가져간 뒤라 줄었다.

**주입 형태** — `initProbView({ getSnapshot, getProbView, getHideZeroProb, render, els })`.
`circuit` 은 getter(`getSnapshot`), `probView`·`hideZeroProb` 도 getter(런타임에 바뀐다),
`render` 는 `function` 선언이라 호이스팅되므로 값으로 넘긴다.

**치환 20줄** — 처음에 "6곳"이라 적었던 것은 **옮긴 블록 안만 센 수**였고 main.js 쪽
9줄이 빠져 있었다. `scripts/check-move-accounting.mjs` 가 세어 준 실제 목록이 아래다.

| 유형 | 줄 | 어디 |
|---|---|---|
| `circuit.getSnapshot()` → `getSnapshot()` | 7 | 옮긴 블록 |
| `hideZero: hideZeroProb,` → `hideZero: getHideZeroProb(),` | 2 | 옮긴 블록 |
| `const chartTooltip =` → `chartTooltip =` | 1 | 옮긴 블록 |
| `probView`·`aggregate` 를 getter 호출로 (`getProbView()` / `getAggregate()`) | 3 | 블록 1 + main 2 |
| `sampling` → `isSampling()` | 2 | main |
| `sampleResult = null;` → `clearSample();` | 1 | main |
| import 축소 (quantum · probmodel · tokens) | 3 | main |
| 주석 교체 (아래) | 1 | main |
| **합계** | **20** | **블록 11 + main 9** |

그 밖의 426줄은 원문 그대로임을 프로그램으로 확인했다.

**주석 교체 한 줄** — `initPlayback` 주입 객체 바로 위의 주석(옛 `main.js` 1787행)을
`// probView·aggregate 는 main 이 소유하는 가변 상태라 호출 시점에 읽어 넘긴다.` 에서
`// probView 는 main, aggregate 는 probview 소유 — 둘 다 호출 시점에 읽는다.` 로 바꿨다.

`aggregate` 의 소유가 실제로 probview 로 넘어갔으니 **내용은 옳다.** 그래도 여기 남기는
이유는 이것이 **"이동만 한다" 원칙 밖의 변경**이기 때문이다. 주석이 코드와 어긋난 채로
남는 것보다 낫다고 판단해 예외를 둔 것이고, 판단이지 규칙이 아니다. 다음 단계에서
같은 상황이 오면 다시 판단한다.

**줄 수 회계** — 2,047 → 1,628. 처음 보고한 "−426 이동, +23"으로는 1,644 가 되어 16줄이
남는다. **조용히 사라진 줄은 없다.** "426 이동"과 "20 치환"을 배타적으로 세지 않은 것이
원인이다 — 치환 20줄 중 **11줄은 옮긴 426줄 안에** 있다.

`git diff a44ae00^ a44ae00 --numstat` 이 근거다 — `a44ae00` 이 4단계 이동 커밋이다.
**상대 ref(`HEAD~2`)를 쓰지 않는다**: 커밋이 쌓이면 같은 표기가 다른 커밋을 가리켜,
이 문서가 스스로 틀린 근거를 내놓게 된다. 문서 머리의 "줄 번호가 아니라 심볼로 한다"와
같은 취지다.

| 파일 | added | deleted |
|---|---|---|
| `js/main.js` | 25 | 444 |
| `js/probview.js` | 478 | 0 |

`2,047 − 444 + 25 = 1,628` 로 정확히 닫힌다. 내역은:

- **삭제 444** = 옮긴 426 + `probview.js` 헤더에 다시 쓰인 import 5줄 +
  블록을 떼며 남은 빈 줄 3 + main 제자리 치환 10.
- **추가 25** = 제자리 치환 10 + `initProbView` import 1 + 배선 블록 14.

제자리 치환은 10줄인데 체커가 잡은 main 쪽은 9줄이다. 차이 한 줄은 옛
`if (sampleResult && …) sampleResult = null;` 로, `invalidateStaleSample` 의 본문이 되어
`probview.js` 에 **원문 그대로** 들어갔기 때문에 "어디에도 없는 줄"이 아니다.

같은 이유로 **numstat 의 added 25 와 체커가 보고한 "새로 추가된 줄" 23 이 다르다.**
차이 2줄은 `});` 처럼 **옛 main.js 에도 같은 글자로 있던 줄**이다. 체커는 다중집합으로
세므로 그런 줄은 옛 것과 상쇄되어 "새 줄"로 잡히지 않는다. numstat 은 위치를 보므로
새 줄로 센다. **둘 다 맞다** — 세는 단위가 다를 뿐이다. 적어 두지 않으면 다음 단계에서
같은 2줄을 다시 파헤치게 된다.

## 3. 각 단계의 검증

`node --test` 는 필요조건이지 충분조건이 아니다. 단계마다 셋을 모두 한다.

### (a) 정적 — 자동화 가능
- 모든 `js/*.js` 를 `node --check` (문법 훅은 편집분만 보므로 전체를 따로).
- **임포트 해석 검증**: 모든 `import ... from "./x.js"` 의 대상 파일이 실재하는지
  스크립트로 확인. **683d624 가 정확히 이걸 안 해서 났다.**
- 내보낸 이름과 가져온 이름 대조(오타 하나로 `undefined` 가 된다).
- **첫 줄 주석 확인**: CLAUDE.md 코드 스타일이 `js/*.js` 첫 줄에 그 모듈이 무엇을
  담당하는지 한 줄 주석을 요구한다. 새로 만드는 파일 전부에 넣는다. **`main.js` 는
  완료** — 3단계에서 채웠고, 지금 1행이
  `// 앱 진입점. DOM 배선과 이벤트 핸들러 — 컨트롤러 콜백을 받아 화면 전체를 갱신한다.`
  다(실제로 읽어 확인). 남은 단계에서는 새로 만드는 `gatemenu.js`·`grid.js` 만 보면 된다.
- **이동 회계** — `node scripts/check-move-accounting.mjs <옛 main.js> js/main.js <옮긴 파일...>`.
  옮긴 내용이 원문과 같은지만 보면 **삭제는 안 잡힌다** — 이 체커가 반대편, 즉 옛
  main.js 에 있었으나 새 main.js 에도 옮긴 파일에도 없는 줄을 센다. 실패하면 의도한
  치환인지 확인해 이 문서에 적거나 되돌린다. 4단계 줄 수가 16줄 어긋났던 것이 계기다.

  옛 파일은 `git show <그 단계 직전 커밋의 해시>:js/main.js > /tmp/old-main.js` 로 뜬다.
  **상대 ref(`HEAD~1`)를 쓰지 않는다** — 그 사이에 커밋이 하나라도 더 쌓이면 엉뚱한
  스냅샷과 비교하고, 그 결과는 "통과"로 보인다. 해시를 적어라.
- **스코프 섀도잉** — `node scripts/check-shadowing.mjs js`. 함수 안 지역 선언이 같은
  이름의 모듈 변수를 가리는 것을 잡는다. 4단계에서 `const chartTooltip` 을 init 안으로
  그대로 옮겨 툴팁이 영원히 `undefined` 가 될 뻔했고, **문법 검사도 테스트도 못 잡았다.**

두 체커는 `scripts/` 에 있고 **단계마다 돌린다.** 실패는 곧 회귀이므로 넘어가지 않는다.

#### 체커가 못 잡는 것 — 통과를 안전으로 읽지 마라

체커는 각각 한 가지만 본다. 무엇을 안 보는지 적어 두지 않으면 초록색이 실제보다 넓은
보증으로 읽힌다.

- **`check-shadowing.mjs` 는 재선언만 잡는다.** 최상위 이름이 함수 안에서 다시 선언되는
  형태만 본다. 최상위 변수가 **아무 데서도 대입되지 않아** 영원히 `undefined` 인 경우는
  못 잡는다 — 예를 들어 `let chartTooltip;` 만 두고 init 에서 대입하는 줄을 통째로
  빠뜨리면 통과한다.
- **`check-move-accounting.mjs` 는 줄 단위 다중집합이라 순서를 못 본다.** 옮긴 블록 안에서
  두 줄이 뒤바뀌어도 통과한다. 순서 보장은 이 체커의 일이 아니라 **"원문과 한 글자도
  다르지 않음" 검사**(옮긴 블록을 원문 슬라이스와 문자열 포함으로 대조하는 쪽)의 몫이다.
  둘을 같이 돌려야 이동이 증명된다.

#### 실행 환경 — Git Bash 를 쓴다

**PowerShell 로 돌리지 마라.** 두 가지가 조용히 깨진다.

- `/tmp` 를 `C:\tmp` 로 해석해 옛 파일을 못 찾는다.
- PowerShell 5.1 의 `>` 는 **UTF-16 으로 쓴다.** 체커가 NUL 을 감지해 `exit 2` 로 죽는다
  (조용히 오독하지 않도록 그렇게 만들어져 있다). BOM 도 마찬가지 이유로 벗겨 낸다.

### (b-0) 서빙 방법 — 단계 전에 확정한다

`file://` 로는 안 된다. importmap 과 ES 모듈이 http 를 요구한다. 리포에는 서버 명령이
없고 의존성도 0이므로 밖에서 띄운다.

VS Code Live Server 확장이 가장 간단하다 — `index.html` 우클릭 → "Open with Live
Server". 없으면:

```bash
npx serve .
```

`npx` 는 프로젝트에 아무것도 설치하지 않으므로 "의존성 0" 을 깨지 않는다.

**어느 쪽이든 여섯 단계 내내 같은 방법을 쓴다.** 방법을 바꾸면 콘솔 에러가 코드 때문인지
서빙 때문인지 구분할 수 없다.

첫 단계 전에 **분해 전 상태로 한 번 띄워 콘솔 에러 0 을 확인한다.** 이것이 기준선이다.
원래 에러가 있었다면 그 목록을 적어두고, 이후 단계에서 새로 생긴 것만 문제로 본다.

### (b) 동적 — 앱을 실제로 띄운다
`index.html` 정적 서빙 → 콘솔 **에러 0** 확인 → 단계별 스모크 시나리오:

| 단계 | 반드시 눌러볼 것 |
|---|---|
| 1 | 게이트 드롭 → 각도 팝오버 → Apply / Esc 취소 / 컨트롤 드롭 → 다중 선택 |
| 2 | 재생 ▶ → 인디케이터 이동 / 스텝 ◀▶ / 되감기 |
| 3–4 | Hide 0% 토글 / Run 샘플링 / Classical↔Qubits 전환 / 측정 회로에서 배지 |
| 5 | 게이트 좌클릭 메뉴 / Show info 행렬 / Delete 키 |
| 6 | 큐비트 추가·삭제 / 연결선 어긋남 / 패널 높이 |

### (c) 회귀
3단계에서 만든 `probmodel` 테스트가 여기 해당한다. 다른 단계는 자동 회귀가 없으므로
**(b) 가 유일한 방어선**임을 인정하고, 단계를 작게 유지하는 것으로 대신한다.

## 3-1. 단계 커밋 — 되돌릴 수 있는 상태를 만든다

**각 단계는 검증을 통과한 뒤 독립 커밋으로 남긴다.** 여섯 단계를 한 커밋에 몰면
4단계에서 문제가 났을 때 3단계 상태로 돌아갈 방법이 없다.

CLAUDE.md 대로 커밋은 사람이 한다. 에이전트는 단계가 끝나면 검증 결과를 보고하고
멈춘다. 커밋 뒤 다음 단계를 지시받는다.

커밋 메시지는 무엇이 어디로 갔는지만 적는다:

```text
Move popover handling out of main.js

Extracts place/control/bit/param popovers into js/popover.js as a factory,
following the codepanel.js pattern. Behaviour unchanged — moves only.
```

### 실패했을 때

검증 (a)(b) 중 하나라도 실패하면 **그 단계를 고치려 들지 말고 되돌린다.**

```bash
git checkout -- js/
```

되돌린 뒤 무엇이 왜 깨졌는지 보고한다. 부분적으로 고친 상태로 다음 단계에 가지
않는다 — 683d624 가 정확히 그 상태로 방치된 경우다.

새 파일이 만들어졌으면 추적되지 않으므로 `git checkout` 으로 안 지워진다.
`git status --short` 로 확인하고 손으로 지운다.

### 단계 사이에 하지 않을 것

커밋과 커밋 사이에 다른 작업을 끼워넣지 않는다. 분해 중에 문서를 고치거나 테스트를
추가하면 다음 단계가 깨졌을 때 원인이 섞인다. 3단계의 테스트 추가는 계획된 것이므로
예외다.

## 4. 위험 지점

1. **임포트 경로 (683d624 재발)** — 새 파일도 `js/` 평면에 둔다. **하위 디렉터리를
   만들지 마라.**
2. **모듈 최상위 부수효과와 초기화 순서** — 지금 `const scene = createBlochScene(...)`
   와 DOM 핸들 52개가 로드 시점에 즉시 실행된다. 쪼개면 import 순서가 실행 순서가 된다.
   팩토리 패턴(`initX(deps)`)이면 부수효과가 호출 시점으로 미뤄져 위험이 사라진다.
   **최상위에서 즉시 실행하는 코드를 새 모듈에 넣지 마라.**

   **부수효과는 `getElementById` 핸들만이 아니다.** 4단계에서 차트 툴팁이
   `document.createElement` + `document.body.appendChild` 를 로드 시점에 실행하고
   있었다. 이 형태를 놓치면 새 모듈이 `document.body` 가 있어야만 import 되는 파일이
   된다.

   **함수 안으로 옮길 때 `const` 를 대입으로 바꿔야 한다.** 선언째 옮기면 init 지역
   변수가 같은 이름의 모듈 변수를 가려, 모듈 변수는 영원히 `undefined` 로 남는다.
   글자는 그대로라 이동 검사도 통과하고 `node --check` 도 `node --test` 도 못 잡는다.
   4단계에서 실제로 그렇게 만들었다가 되돌렸다.
   → `node scripts/check-shadowing.mjs js` 가 이 형태를 잡는다. 단계마다 돌린다.
3. **배선 순서 — 모듈마다 다르다** — `createCircuitController` 는 반환 직전에 `notify()` 를
   부른다. 그래서 `render` 가 컨트롤러 생성 **도중에** 한 번 돈다.
   `render` 경로에 걸리는 모듈(playback · probview · gatemenu · grid)은 컨트롤러보다
   **먼저** 배선하고 `circuit` 을 getter 로 받는다. 값으로 받으면 TDZ 로 로드 즉시 죽는다.
   `render` 를 안 타는 모듈(popover)만 컨트롤러 뒤에 배선한다.
   **어느 쪽인지는 단계마다 확인한다** — 2단계에서 계획이 정반대였음이 드러났다.
   **모듈 사이의 순서도 있다**: 4단계에서 playback 이 probview 의 `buildProbTween` 과
   `getAggregate` 를 받으므로 probview 가 playback 보다도 먼저다.
4. **`test/menu.test.mjs` 가 main.js 를 텍스트로 읽는다** — `menu.setAction("code", ...)`
   호출이 main.js 에 남아야 한다. 코드패널 배선을 옮기면 이 테스트가 깨진다.
5. **`render` 안의 순서 제약** — A 의 셋. 분배 함수를 만들 때 **주석으로 남기지 않으면**
   나중에 누가 재배열한다.
6. **`highlightedCol` / `stepIndicatorEl`** — `buildCircuitGrid` 가 그리드를 다시 지으면
   인디케이터가 무효가 된다. 6단계에서 재등록 경로를 놓치면 **재생 중에만** 드러나는
   버그가 된다(정지 화면으로는 정상으로 보인다).

## 5. 하지 말아야 할 것

**분해 중에는 오직 옮기기만 한다.** `design-spec.md` 분할에서 확인한 원칙이다 — 이동과
삭제를 섞으면 줄어든 것이 의도인지 실수인지 구분할 수 없다. 여기서는 더 심각하다.
**테스트가 안 덮으므로 "구분할 수 없음"이 곧 "발견할 수 없음"이다.**

**두 이유다.** (a) 이동만 하면 "동작이 같아야 한다"가 검증 기준이 되는데, 수정을 섞으면
그 기준이 사라진다. (b) 옮긴 뒤에는 각 파일이 작아져 고칠 때 영향 범위가 눈에 보인다.

### 리뷰가 지적한 Warning 세 건 — 전부 분해 후에 고친다

`code-reviewer` 가 `js/main.js` 에서 찾은 것이 이 셋이다(Critical 은 없었다).
**셋 다 옮겨지는 코드 안에 있어, 고치려면 옮기는 중에 손대야 한다. 그래서 미룬다.**

| # | 내용 | 어디로 옮겨지나 | 언제 고치나 |
|---|---|---|---|
| 1 | **`scheduleAggregate` 의 스테일 `aggregate`** — 서명이 바뀌면 150ms 디바운스만 걸고 옛 `aggregate` 를 그대로 두는데 `render` 는 곧바로 동기 `renderProbabilities` 를 부른다. 궤적 회로에서 큐비트 수를 바꾸면 옛 길이의 `aggregate.qubitProbs` 를 새 인덱스로 참조해 **NaN 막대**가 뜨고, classical 뷰는 막대 개수와 라벨이 어긋난다. 수정안은 서명 불일치 판정 직후 `aggregate = null` 한 줄 | `probview.js` (4단계) | 4단계 커밋 후 |
| 2 | **`openGateMenu` 의 keydown 리스너 누수** — 영속 요소에 매번 새로 붙이는데 `closeGateMenu` 는 `innerHTML=""` 만 하고 떼지 않는다. 리스너가 누적되고 옛 클로저가 분리된 버튼에 `.focus()` 를 호출하며 전역 `menuIndex` 를 덮어쓴다. 수정안은 `AbortController` 로 해제하거나 내부 컨테이너에 등록 | `gatemenu.js` (5단계) | 5단계 커밋 후 |
| 3 | **`inspectOn` 이중 소스** — C 절이 찾은 것과 같다. `circuit.getSnapshot().inspectMode` 로 대체 가능 | 진입점에 잔류 | 6단계 커밋 후 |

참아야 할 것:

- **위 Warning 세 건** — 발견해 두었지만 분해 중에 고치지 않는다
- 함수 이름 정리, 인자 순서 정돈, 중복 제거
- `probDisplay` 인자화 이상의 시그니처 변경 — 3단계에서 필요한 최소만
- DOM 조회를 캐시로 바꾸거나 그 반대
- `buildCircuitGrid` 290줄을 더 쪼개기 — 6단계는 **파일만 옮기고** 내부는 그대로

---

# 부록 · 조사 중 발견 (계획에 영향 없음, 이번에 고치지 않음)

1. **`test/menu.test.mjs` 가 소스 텍스트를 정규식으로 검사한다.** 다른 테스트는 모듈을
   임포트해 동작을 보는데 이것만 파일을 문자열로 읽는다. 리팩터링에 취약하다.
2. **`workspace` 를 두 번 조회한다** — 최상위 `const` 와 `codePanel` 배선의 `els.workspace`.
2-1. **`probSampling` · `probHideToggle` 은 잡아만 놓고 아무 데서도 안 쓴다**(4단계에서
   확인). 죽은 DOM 핸들 둘이다. **상태: 6단계 커밋 후 정리 대기.**

   아래 셋과 **한 번에** 치운다. 전부 "죽었거나 이중인 것"이고, 분해가 끝나야 각각의
   영향 범위가 눈에 보이기 때문이다. 넷을 한 커밋으로 묶으면 "이번 커밋은 죽은 코드
   정리"라는 성격이 분명해져, 이동 커밋들과 섞이지 않는다.

   | 항목 | 어디 |
   |---|---|
   | `probSampling` · `probHideToggle` 미사용 | 부록 2-1 (여기) |
   | `workspace` 이중 조회 | 부록 2 |
   | `GATE_ENABLED` 빈 객체 | 부록 3 |
   | `inspectOn` 이중 소스 | 5절 Warning 3 |
3. **`GATE_ENABLED` 가 빈 객체다.** 주석은 "IF는 고전 레지스터가 생기며 활성화되었다"
   인데 이제 아무것도 막지 않으므로 죽은 코드로 보인다.
4. **`inspectOn` 은 `circuit.getSnapshot().inspectMode` 로 대체 가능하다** — 유일한
   스냅샷 이중화.
5. **`renderStateFormula`(90줄)와 `renderDensityMatrix`(50줄)가 진입점에 남는다.**
   다섯째·여섯째 덩어리 후보이지만 서로 참조가 없고 `render` 만 부르므로 지금 쪼갤
   이유가 약하다.

---

# 이 문서에 대하여

0~4단계는 이 문서가 리포 **밖**에 있는 동안 진행됐다. 4단계 회계를 닫으면서 리포 안
`docs/main-js-decomposition.md` 로 옮겼다 — 5·6단계와 그 뒤의 정리 커밋이 이 문서를
계속 고칠 것이고, 코드와 같은 이력에 남아야 어느 커밋에서 무엇이 바뀌었는지 보이기
때문이다. **이제부터는 리포 안의 이 파일이 원본이다.**

`docs/` 의 다른 둘과 성격이 다르다. `design-spec.md` 와 `quantum-spec.md` 는 **제품이
무엇인가**를 적은 명세라 오래 간다. 이 문서는 **한 번의 리팩터링 기록**이라 6단계와
정리 커밋이 끝나면 역할이 끝난다. 그때 지울지 남길지 정한다.
