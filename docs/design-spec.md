# 프로젝트 지침서: 토스 스타일 블로흐 구 시각화 웹앱
UI·색상·레이아웃·타이포그래피·아이콘·패널 구조 규격을 담는다.
docs/design-spec.md 를 분할한 것이며 아직 정리 전이라 중복이 남아 있다.

## 1. 프로젝트 개요
- **목표:** 양자 큐비트 상태(Bloch Sphere)를 토스(Toss) 앱처럼 직관적이고 친근하며 극도로 미니멀한 UI/UX로 시각화하는 인터랙티브 웹앱 구현.
- **핵심 기술 스택:** HTML5, CSS3, JavaScript (Three.js 기반 3D 렌더링).
- **플랫폼:** 데스크톱(PC) 웹 전용. 모바일 웹 대응은 고려하지 않는다.
- **배포/문서:** 라이브 `https://seolwon64.github.io/quantumtools/`(GitHub Pages, main). `README.md`는 앱 쇼케이스(영어·캐주얼 톤, 기능 하이라이트 + 하단에 학습 여정), 스크린샷은 `docs/screenshots/`(hero/bloch/qsphere/sampling/playback). `LICENSE`는 MIT. 스크린샷은 Playwright(SwiftShader)로 재생성 가능.

## 2. 토스(Toss) 스타일 UI/UX 디자인 원칙
AI 에이전트는 모든 컴포넌트와 화면을 구성할 때 아래의 토스 디자인 시스템(TDS) 특징을 엄격히 준수해야 합니다.

### 2.1. 극단적인 미니멀리즘 (Minimalism)
- **정보의 최소화:** 한 화면이나 한 카드 안에는 사용자가 지금 당장 집중해야 하는 핵심 정보와 액션만 노출한다. 불필요한 테두리, 과도한 텍스트, 복잡한 구분선은 과감히 제거한다.
- **여백의 미:** 컴포넌트 간의 간격(Margin/Padding)을 넓게 배치하여 시각적인 답답함을 없애고 시원한 느낌을 준다.

### 2.2. 시각적이고 친근한 아이콘 및 UI
- **직관적인 그래픽:** 텍스트 설명보다 직관적인 그래픽과 메타포를 활용한다. (예: 게이트 적용, 상태 초기화 등은 친근한 아이콘이나 버튼 UI로 표현)
- **둥근 모서리 (Roundness):** 모든 카드 레이아웃과 버튼은 둥근 모서리(`border-radius: 20px~24px`)를 적용하여 부드럽고 친근한 인상을 준다.

### 2.3. 토스 특유의 컬러 시스템 (Color Tokens)
- **배경색 (Background):** 기본 배경은 완전한 화이트`(#FFFFFF)` 또는 아주 깨끗하고 밝은 회색`(#F2F4F6)`을 사용하여 요소들을 돋보이게 한다.
- **포인트 컬러 (Primary):** 가장 중요한 행동 유도(CTA) 버튼이나 활성화된 상태, 블로흐 구의 상태 벡터 화살표에는 **토스 블루(`#3182F6`)**를 사용한다.
- **텍스트 컬러 (Typography):** - 주 텍스트(타이틀, 강조): `#191F28` (완전한 검은색이 아닌 짙은 쥐색)
  - 부 텍스트(설명, 단위): `#4E5968` (부드러운 회색)

### 2.4. 부드러운 마이크로 인터랙션 (Micro-interactions)
- **버튼 피드백:** 사용자가 버튼을 클릭하거나 탭할 때, 버튼 크기가 쫀득하게 살짝 작아졌다가 커지는 스케일 애니메이션(`transform: scale(0.96)`)을 적용한다.
- **부드러운 상태 전환:** 슬라이더나 버튼으로 $\theta, \phi$ 값이 바뀔 때, 블로흐 구의 화살표 벡터가 툭툭 끊기지 않고 목표 지점까지 부드럽게 스르륵 이동(Linear Interpolation/Lerp 등 활용)하도록 구현한다.

## 3. 기능 및 구현 가이드
### 3.t. 아이콘 — Lucide 한 세트 (`js/icons.js`)
아이콘은 **Lucide(lucide.dev, ISC)** 하나로 통일한다. 24×24 그리드·균일한 스트로크로 만들어져 어떤 조합을 써도 한 세트로 보인다. 예전에는 이모지 문자(`⏮ ◀ ▶ ⟲ ▾ ⚠`)와 손으로 그린 SVG가 섞여 있었다.
- **npm 패키지를 도입하지 않는다.** 빌드 도구가 없는 vanilla JS 프로젝트라 아이콘 하나로 의존성·번들 단계를 들일 이유가 없다. lucide.dev에서 **경로 데이터만** `js/icons.js`에 옮겨 담는다.
- **규격은 `ICON_SIZE = 16` · `ICON_STROKE = 1.5` 두 상수가 전부**다. Lucide 기본 24px/2는 이 밀도의 툴바에서 크고 두껍다. **호출부에서 크기·굵기를 다시 정하지 마라** — 그 순간 "한 세트"가 깨진다. CSS로 덮어쓰는 것도 금지(정의처가 두 곳이 된다). `test/icons.test.mjs`가 이 규격을 고정한다.
- **`stroke: currentColor` + `fill: none`.** 색을 박지 않으므로 색상 토큰이 바뀌든 밝은/어두운 배경으로 옮기든 아이콘이 따라온다(예: 재생 버튼은 액센트 배경 위에서 획이 자동으로 밝아진다).
- **정의는 `js/icons.js` 한 곳뿐이다.** index.html은 `<span data-icon="undo-2">` 자리표시자만 두고 `hydrateIcons()`가 채운다. HTML과 JS에 같은 SVG를 두 벌 두면 반드시 어긋난다(3D 씬 색이 CSS 램프와 어긋났던 것과 같은 실패).
- **이모지·기하 기호를 UI 아이콘으로 쓰지 않는다.** 플랫폼마다 글리프가 달라 크기·정렬·색을 제어할 수 없다.
- **아이콘은 `aria-hidden="true"`, 의미는 버튼의 `aria-label`이 전달한다.** 아이콘만 있는 버튼은 예외 없이 `aria-label`을 가진다(팔레트의 글리프 칩 포함). 보이는 텍스트가 있으면 `aria-label`이 그 텍스트를 **포함**해야 한다(WCAG 2.5.3 Label in Name) — 그래서 Examples 버튼은 `"Examples — load an example circuit"`.
- **경계**: `⊕`(CNOT 타깃)·`×`(SWAP)·`⋮`(Barrier)·`√`·`⟨⟩ψρθφ`는 **회로/수학 표기이지 UI 아이콘이 아니다.** Lucide로 바꾸면 오히려 관례에서 벗어난다. 측정 게이지(`MEASURE_SVG`)도 Qiskit 표기라 게이트 칩 크기를 따르며 Lucide 세트에 속하지 않는다. 이 문자들은 폴백 폰트를 **자체 호스팅**하므로 플랫폼 차이가 없다(3.x 참조).

### 3.p. 드로어 — 메뉴(모달) · 코드(비모달)
햄버거 메뉴는 왼쪽에서, 코드 패널은 오른쪽에서 슬라이드한다. **성격이 달라 오버레이도 다르다**:
- **메뉴** — 고르면 바로 닫히는 일시적 UI라 오버레이로 뒤를 딤 처리해 집중시킨다. `aria-modal="true"`.
- **코드** — 회로를 보면서 읽는 패널이라 **오버레이를 두지 않는다.** 뒤를 가리면 목적이 사라진다. `aria-modal` 없음.

**`.hidden`(display:none)을 드로어에 쓰지 마라.** `display: none`에서는 transition이 실행되지 않아 슬라이드가 통째로 죽는다 — 정지 화면으로는 똑같아 보여 늦게 발견된다. 열림은 `.is-open`, 닫힘은 `visibility: hidden`(탭 순서에서도 빠져 접근성에도 맞다).

**`transform: translateX`만 애니메이션한다.** `width`/`left`를 움직이면 매 프레임 레이아웃이 다시 계산돼 끊긴다. 시간은 `--dur-drawer`(180ms) — 이동 거리가 길어 버튼용 `--dur`(120ms)로는 튕기듯 보인다. 이징은 `--ease` 공유. `prefers-reduced-motion`은 파일 상단의 전역 규칙이 이미 덮는다.

**햄버거는 드로어보다 위(`z-index: 66`)에 있어야 한다.** 열린 상태에서 이 버튼이 곧 닫기(X)인데, 드로어(65)가 덮으면 **마우스로 X를 누를 수 없다**(실제로 겪음). 같은 이유로 드로어 위쪽을 헤더 높이(60px)만큼 비워 X가 첫 항목을 덮지 않게 한다.

**포커스 트랩에 햄버거를 포함한다.** 드로어 바깥에 있어도 논리적으로 이 다이얼로그의 닫기 버튼이다 — 빼면 키보드로 닫기에 도달할 수 없다. 순환은 `[...항목, menuBtn]`.

**메뉴 항목은 데이터로 선언한다**(`MENU_GROUPS` in [js/menu.js](js/menu.js)). 배열 하나가 그룹 하나이고 그룹 경계에만 1px `--gray-6` 구분선이 들어간다 — 그룹이 늘어도 HTML을 손대지 않는다. `kind: "panel"`이 "패널을 여는 항목"과 "페이지를 이동하는 항목"을 가르며, 패널 항목에는 `aria-haspopup="dialog"`를 붙인다. **페이지 이동은 만들지 않았다** — 쓰이지 않는 분기는 곧 죽은 코드다.

**자리표시자나 비활성 항목을 넣지 않는다.** 미구현 항목이 보이면 앱 전체가 미완성으로 읽힌다. Gate reference / Keyboard shortcuts / Settings / About은 각자 구현될 때 그룹으로 추가한다. `test/menu.test.mjs`가 "coming soon" 문구와 `disabled: true`를 막는다.

### 3.q. 세그먼트 토글 — 선택에 따라 크기가 변하면 안 된다
`.segmented`(Bloch/Q-sphere, 큐비트 탭)는 **어느 쪽이 활성이든 기하가 동일**해야 한다.
- **왜 깨졌었나**: `.sphere-footer`는 `space-between` flex이고, **Bloch 모드에서만** `.bloch-info`(Purity+Mixedness, 223px)가 나타나 토글을 밀어냈다. `white-space` 제한이 없어 "Q-sphere"가 두 줄로 접히며 **토글이 41px → 58px로 커지고 17px 위로 밀렸다**(1440px 이하에서 재현. 1600px는 여유가 10.5px뿐이라 간신히 통과했다).
- **`flex: 1`로는 두 버튼 폭을 못 맞춘다.** 컨테이너가 콘텐츠 크기(shrink-to-fit)면 나눠 줄 여유가 0이라 각 버튼이 자기 콘텐츠 폭에 머문다(실측 52.3 vs 75.2). **`display: grid; grid-template-columns: repeat(2, 1fr)`** 를 쓴다 — auto 폭 grid의 `1fr` 트랙은 가장 넓은 아이템 기준으로 균등해진다.
- `.segmented { flex: none }` + `.segmented-btn { white-space: nowrap }`. 양보는 **읽기 전용 정보**(`.bloch-info`)가 한다 — 조작 대상이 흔들리면 안 되기 때문. 그 안에서도 `.bloch-mixed-bar`가 먼저 줄어든다(바는 장식, 옆의 %가 정보).
- **활성 표시는 배경색·글자색으로만** 한다. `font-weight`를 바꾸면 글자 폭이 달라져 크기가 미세하게 흔들린다(둘 다 700으로 고정).
- 실측: 뷰포트 1600/1440/1280/1024px × 전환 10회에서 토글·버튼의 w·h·x·y **고유값 1개**.

### 3.r. 회로 격자 좌표 — CSS를 베껴 쓰지 않는다
연결선·제어점·⊕·×·고전 이중선·비트 배지·스텝 인디케이터의 좌표는 **`gridCenter(el, gridRect)` 하나에서만** 나온다. 실제 배치된 셀의 `getBoundingClientRect()`를 읽으므로 CSS를 어떻게 바꿔도 어긋날 수 없다.
- **왜 이렇게까지 하는가**: 예전에는 `GRID_PAD_LEFT = 2`, `ROW_PITCH = 56` 같은 상수로 CSS 치수를 손으로 옮겨 적었다. 간격 시스템 도입(`ab4683a`)이 padding을 `2px → var(--space-1)`(4px), gap을 `6px → var(--space-2)`(8px)로 바꿨는데 **상수는 갱신되지 않아 연결선이 가로 2px·행마다 세로 2px씩 어긋났다.** 값을 고치는 것으로는 부족하다 — 두 곳에서 계산하는 구조 자체가 원인이다.
- 셀 조회는 `cellAt(col, row, qubitCount)` — `.grid-cell[data-col][data-qubit]`(고전 행은 `.clbit-row .grid-cell[data-col]`).
- 좌표는 `Math.round`로 정수 스냅한다. 연결선 폭이 **짝수**(2px·4px)라 정수 좌표면 선명하다 — 0.5px 오프셋은 홀수 폭에만 필요하며 여기선 쓰지 않는다.
- 패널 최소 높이도 `circuitGrid.scrollHeight`로 실측한다(행 높이·gap을 JS에서 다시 계산하지 않는다).
- 실측 결과: 확대율 100%/125%/150%, 큐비트 2~6개 전부에서 **선·블록·제어점·기호의 x 편차 0px**, 선 끝과 셀 중심 간격 0px.

### 3.u. 패널의 시각적 위계
화면을 봤을 때 **데이터(회로·차트·구)가 먼저 보이고 제목·라벨은 배경으로 물러나야** 한다. 눈대중이 아니라 **패널 배경 대비 대비비**로 검증한다.
- **텍스트 4칸 램프**: `--text-title`(gray-12) → `--text-body`(gray-11) → `--text-faint`(gray-10, **패널 제목**) → `--text-label`(gray-9, **카테고리 라벨**). 대비 실측 17.01 / … / 3.51 / 3.08.
- **패널 제목**(CIRCUIT·OPERATIONS·PROBABILITIES·Q-SPHERE·REDUCED DENSITY MATRIX): `--text-sm` 11px · w600 · `letter-spacing .06em` · 대문자 · `--text-faint`. 제목→콘텐츠 간격 `--space-3`. **다섯 개가 값까지 동일**해야 한다 — `.sphere-mode-title`은 예전에 13px/w700/gray-12라 화면에서 가장 강한 텍스트였고, `.dm-header`·`.preset-cat`은 w700이라 **패널 제목보다 굵은 위계 역전**이었다.
- **카테고리 라벨**: `--text-xs` 10px · w500 · 대문자 · `--text-label`. 크기·굵기·대비 **셋 다** 제목보다 낮아야 한다(하나만 낮추면 위계가 서지 않는다).
- **데이터를 `--text-faint`로 쓰지 않는다.** `.qubit-label`(q[0]…)이 그랬는데, 대비가 제목과 **똑같이 3.51**이라 "몇 번 큐비트인가"가 제목만큼 뒤로 물러나 있었다 → `--text-body`.
- **패널 상자**: 배경 `--gray-2`, 앱 배경 `--gray-1`, **그림자 없이** 1px `--gray-6` 테두리로만 구분, `--radius-3`, 안쪽 `--space-4`, 패널 사이 `--space-3`(`.col-splitter`/`.row-splitter` 폭). 예외는 `.panel-sphere { padding: 0 }` 하나 — 3D 뷰는 테두리까지 꽉 차야 하고 `overflow: hidden`이 모서리를 잘라준다.
- **구분선은 남발하지 않는다.** 여백으로 갈라지면 선을 넣지 않는다. 현재 방향성 테두리는 회로 의미론(`.step-indicator` 점선, `.cl-connector` 고전선)과 아이콘 바 그룹 구분선(`.gate-menu-sep`, 1px `--gray-6`)뿐이다.
- **flex 헤더 안의 제목에는 `margin-bottom`을 두지 않는다.** flex 아이템의 margin은 정렬 박스에 포함돼 **제목만 위로 밀린다** — 여백은 헤더 자신에게 준다(`.palette-header`).

### 3.v. 인터랙티브 상태 — 5개
클릭 가능한 모든 요소에 **default / hover / active / focus-visible / disabled**를 예외 없이 정의한다(도입 전에는 focus-visible이 **1개 요소에만**, active가 4개에만 있었다). 정의는 style.css 맨 아래 한 블록에 모여 있다.
- **hover** 중립 배경 → `--gray-4` · **active** `--gray-5` + **`transform: scale(0.98)`**(누르는 촉감의 핵심). 자기 색을 가진 요소(Primary·활성 탭·게이트 칩)는 중립으로 덮지 않고 **자기 톤 안에서** 한 단계 진해진다(`--accent-10/11`, `--chip-hover`).
- **focus는 `:focus-visible`만** 쓴다 — 마우스 클릭엔 링이 뜨지 않고 키보드 탐색에만 뜬다. 액센트 2px + `outline-offset: 2px`.
- **disabled** `opacity .45` + `cursor: not-allowed`, **`pointer-events`는 유지**(사유 툴팁을 보여줘야 한다). 네이티브 `disabled` 속성은 브라우저가 마우스 이벤트를 막으므로, 툴팁이 필요한 곳은 `aria-disabled`+`.is-disabled`를 쓴다.
- **비활성 요소는 hover/active 선택자에서 `:not()`으로 제외**한다. 반대로 "적용 후 되돌리기"(`background-color: inherit` 등)로 처리하면 **자기 색을 가진 버튼이 hover 시 투명해진다**(실제로 겪음).
- **`:not()`은 특이도를 올린다.** (이 함정에 **세 번** 걸렸다 — `.segmented-btn.active`, `.gate-menu-item.is-danger`, `.inspect-toggle.is-on`. 자기 색을 가진 변형을 만들 때는 **먼저** 중립 목록에서 제외하라.) `:not()` 3개를 붙인 중립 hover 규칙은 (0,5,0)이라 `.segmented-btn.active:hover`(0,3,0)를 이겨버렸고, **활성 탭이 hover 시 파란 배경을 잃고 흰 글자만 남아 라벨이 사라졌다**(대비 1.03). 같은 함정에 `.gate-menu-item.is-danger:hover`도 걸려 **Delete의 빨강 신호가 회색으로 덮여 있었다**. 자기 색을 가진 변형은 중립 규칙에서 `:not(.active)` / `:not(.is-danger)`로 **아예 제외**한다 — 뒤에서 되돌리려 하지 말고.
- **전환은 `background-color`와 `transform`만**, `--dur: 120ms` + `--ease: cubic-bezier(0.16,1,0.3,1)`. `all`이나 CSS 기본 `ease`를 쓰지 않는다. (확률 막대·mixedness 미터의 height/width 전환은 인터랙션이 아니라 데이터 애니메이션이라 별개다.)
- **커서**: 클릭 `pointer` · 드래그 `grab`/누르는 중 `grabbing`(팔레트 칩) · 비활성 `not-allowed`.
- **버튼 3종**: Primary(액센트 채움 — 재생, 팝오버 Apply) · Secondary(중립+테두리 — Run·Clear all·Examples) · Ghost(배경 없이 hover 시에만 — 아이콘·스텝 버튼).
- 참고: `.gate-chip`은 `draggable`이라 브라우저가 mousedown 시 `:active`를 취소한다 — 눌림 효과가 드래그 시작에는 보이지 않는 게 정상이다.

### 3.w. 색상 — 3층 구조
역할별로 완전히 분리한다. 예전에는 게이트 색과 인터랙티브 색이 모두 파랑이라 "누를 수 있는 것"의 신호가 약했다.
- **(a) 중립 램프 `--gray-1..12`** — 배경·테두리·글자. **Radix `slate`의 명도 구조 + Stripe 수준의 채도**(hue 253°, C를 L에 따라 0.006→0.055). Radix v1 slate 원본을 그대로 쓰던 시절에는 hue가 240~248°로 차가웠는데도 **C가 0.0017~0.0135라 순수 회색으로 읽혔다** — 차가운 인상은 hue가 아니라 **채도**가 만든다. L 12단계는 Radix 값 그대로라 모든 대비 관계가 보존된다(본문 4.79 · 제목 17.03). `js/scene.js`가 이 램프를 읽으므로 3D 구·격자도 함께 차가워진다. **(b) 액센트 하나(`--accent-*`, 파랑)** — 누를 수 있는 것 전용. **(c) 게이트 카테고리** — 아래 3.s.
- 파랑은 **인터랙티브 전용**이다. 게이트 카테고리에 파랑을 쓰지 않는다(그래서 Multi-qubit이 중성 회색이다).
- **위험/경고는 `--danger-bg` / `--danger-fg`**로 분리돼 있다. 예전에는 `--cat-pauli-bg/-fg`를 빌려 썼는데, 게이트 색을 조정하면 경고 배너·Delete 메뉴가 **함께 깨졌다**. 의미가 다르면 토큰도 달라야 한다.

### 3.s. 게이트 카테고리 색 — 카테고리당 **하나** + 같은 hue의 테두리
팔레트 칩과 회로 블록이 **같은 변수(`--cat-*`)** 를 참조한다. 예전에는 `-bg`(팔레트)와 `-c`(회로)로 나뉘어 놓기 전후로 색이 달라졌다.
- **규격: OKLCH `L = 0.70` 고정(7개 전부) · 유채색 `C = 0.15` · 중성 `C = 0.05`.** 채움 `--cat-*` · 테두리 `--cat-*-border`(L=0.52) · hover `--cat-*-hover`(L=0.64) 세 계열.
- **탁함(muddy)의 정체는 "중간 명도 + 중간 채도"다.** L=0.62 / C=0.135이던 시절이 그랬다. 둘 다 올려야 선명해진다 — 한쪽만 올리면 해결되지 않는다.
- **채도 상한은 액센트가 정한다.** `--accent-9`의 C가 0.187이므로 게이트는 그보다 낮은 0.15에서 멈춘다. 7개가 액센트만큼 진하면 화면이 형광펜이 되고 **액센트가 액센트로 기능하지 못한다.** 실측으로 확인: 액센트의 패널 대비 4.62 > 가장 진한 게이트 2.70.
- **L을 올리면 채움만으로 경계가 안 난다.** 패널이 L≈0.98이라 블록이 밝아질수록 휘도차가 줄어 채움의 경계 대비가 2.37~2.70(3:1 미달)이 된다. → **같은 hue·같은 C에서 L만 0.52로 내린 1px 테두리**로 경계를 만든다(대비 4.92~5.62). 밝기와 경계를 동시에 얻는 유일한 방법이다. **테스트도 채움이 아니라 테두리를 기준으로 본다.**
- 글자는 `--gray-12` 그대로. 배경이 밝아져 대비가 **6.30~7.20**으로 오히려 좋아진다. 흰 글자는 여전히 AA 미달이라 뒤집지 않는다.
- **테두리를 붙일 때 걸리는 곳 둘**: (1) `.placed-symbol`(⊕·×)은 배경이 없으므로 `border: none` — 없는 상자가 생긴다. (2) 그런데 **RCCX/RC3X 타깃도 ⊕라 `.placed-symbol`에 걸린다.** 점선은 CCX와 구분하는 유일한 단서이므로 `.placed-gate.placed-advanced`를 **뒤에** 두어 이기게 한다(같은 특이도라 순서가 결정한다).
- 청록(phase 195° · interaction 168°)은 L=0.70에서 C 0.15가 sRGB 색역 밖이라 L·H 고정한 채 C만 줄여 맞췄다(0.119 / 0.142).

### 3.z. 모서리 반경 · 그림자 체계
- **반경 `--radius-1..4`(3 / 5 / 8 / 12px)만 쓴다.** 배지·태그 1 · **버튼과 게이트 블록 2** · 패널·팝오버·컨텍스트 메뉴 3 · 모달 4. 도구 UI라 과하게 둥글면 정교함이 떨어져, 게이트 블록을 10~12px에서 **5px로** 낮췄다(팔레트 버튼도 동일).
  - **예외: 원(`50%`)과 알약(`--radius-full`)** — 제어점·재생 버튼·토글 같은 도형은 "모서리 반경"이 아니라 도형 자체라 스케일 밖이다.
- **그림자 `--shadow-1..3`** — 각 값의 마지막 레이어 `0 0 0 1px`가 **테두리 역할을 겸한다**. 그래서 **이 변수를 쓰는 요소에 `border`를 따로 주면 안 된다**(합쳐져 2px로 보인다). 불투명도를 올리지 않는다 — 그림자는 눈에 띄면 안 되고 느껴져야 한다.
  - 팝오버·컨텍스트 메뉴·툴팁 → `--shadow-2` / 드롭다운(Examples·Export) → `--shadow-3` / 작은 부유 컨트롤(토글 노브·위상 색상환·view-toggle·bloch-info) → `--shadow-1` / **게이트 블록은 그림자 없음**.
- **패널은 그림자로 띄우지 않는다** — `border: 1px solid var(--border-panel)`로 **면을 나눈다**. 도구 UI에서는 카드가 떠 있는 느낌보다 면이 나뉜 느낌이 맞다. `--border-panel`은 임시값(`rgba(0,0,0,.08)`)이고 색상 작업에서 확정한다.
  - 참고: 패널에는 원래 `box-shadow`가 없었다. 흰 카드처럼 보이던 건 회색 배경(`--bg`) 위의 흰 배경 대비 때문이라, 이번엔 그림자를 "제거"한 게 아니라 **경계선을 추가**한 것이다.

### 3.y. 간격(spacing) 시스템
- **`--space-1..8`(4px 배수) 스케일만 쓴다**: 4 / 8 / 12 / 16 / 24 / 32 / 48. `padding`·`margin`·`gap`에 **하드코딩 px를 남기지 않는다**(도입 시 19가지 값 137회 → 스케일 5종 137회로 치환).
- **통일 규칙:** 패널 내부 패딩 `--space-4` · **패널 사이 간격 = 스플리터 두께** `--space-3` · 버튼 내부 패딩 **세로 `--space-2` / 가로 `--space-3`** · 팔레트 게이트 그리드 `--gate-gap: var(--space-2)`.
- **동률 처리:** 6·10·14·20px처럼 두 스케일 값과 등거리인 경우는 위 통일 규칙에 맞춰 고정했다(6→8, 10→12, 14→12, 20→24). 임의로 반올림하지 않는다.
- **허용 예외(주석 필수):** ① 1px 테두리 ② 3D 캔버스 내부 좌표 계산(`scene.js`의 `ROW_PITCH` 등은 레이아웃 여백이 아니라 좌표계다) ③ 아이콘·폰트 광학 보정 1~2px.
- 음수 오프셋은 `calc(var(--space-N) * -1)`로 쓴다(위상 눈금 위치 보정 등).

### 3.x. 타이포그래피 시스템
- **폰트: Geist Sans / Geist Mono (Vercel, SIL OFL)** — `fonts/`에 **자체 호스팅**한다(Google Fonts·CDN 금지: 서드파티 요청 제거 + FOUT 제어). `@font-face`에 `font-display: swap`, 본문 두 폰트는 `<link rel="preload">`.
  - **가변 폰트 1개씩**을 쓴다(`Geist-Variable` 68KB + `GeistMono-Variable` 70KB = 138KB). 정적 400/500/600·400/500 5개(234KB)보다 **작고**, 가변이라 게이트 블록에 쓰는 **weight 550**이 가능하다.
- **수학 기호 폴백(중요):** Geist는 이 앱이 쓰는 **⟨ ⟩ ψ ρ θ φ Φ ⊕ ⋮ ▾ ⟲ ⚠ ⏮ ⏸ 를 갖고 있지 않다**(fontkit으로 cmap 실측). 그대로 두면 그 글자만 시스템 폴백으로 튀므로, **Noto Sans Math / Noto Sans Symbols 2(OFL)를 필요한 코드포인트만 서브셋**해(`"QT Math"`, 합계 3KB) 스택의 **Geist 뒤**에 둔다. `unicode-range`로 범위를 못박아 Geist가 가진 글자(π·†·√·×·−)는 절대 가져가지 않는다. 브라우저 실측 결과 **시스템 폴백으로 남는 기호 0개**.
- **CSS 변수만 쓴다:** `--font-sans`/`--font-mono`, 타입 스케일 `--text-xs 10 / --text-sm 11 / --text-base 13 / --text-md 15 / --text-lg 18`. **이 목록 밖의 크기를 새로 만들지 않는다**(⊕·× 회로 기호만 글자가 아닌 아이콘이라 `calc(var(--text-base) * 1.7)`로 파생).
- **등폭(mono)을 쓰는 곳** — 숫자 열이 세로 정렬되어야 하는 영역 전부를 **style.css 상단 한 블록에 모아** 지정한다: 축소 밀도행렬·유니터리 행렬·상태벡터 진폭·확률 축/기저 라벨·샘플링 카운트·`q[0]`/`c/n`·스텝 카운터·QASM 코드·분해 스텝·각도 값.
- **`button/input/select/textarea`는 폰트를 상속하지 않는다** — 명시하지 않으면 팔레트 게이트 버튼만 Arial로 렌더된다(실제로 겪음). 전역 규칙으로 `font-family/size/weight/feature-settings`를 `inherit`.
- **비-mono 숫자에도 `tnum`**(`font-feature-settings: "tnum" 1` + `font-variant-numeric: tabular-nums`)을 body에 걸어 큐비트 수·스텝 카운터가 바뀔 때 폭이 흔들리지 않게 한다.
- **캔버스 라벨은 폰트 로드 후 다시 그려야 한다** — DOM은 웹폰트가 늦게 와도 자동 리플로우되지만 **캔버스는 한 번 래스터화되면 끝**이다. `scene.js`가 라벨 스프라이트를 `LABEL_SPRITES`에 모아 두고 `document.fonts.ready` 후 재렌더한다. `FONT_STACK`은 `--font-sans`와 **반드시 일치**시킨다.
- **주의:** 등폭은 비례폰트보다 넓어 기존 셀에서 줄바꿈이 생길 수 있다(밀도행렬 `0.000 − 0.500i`가 실제로 그랬다) → 해당 셀은 한 단계 작은 크기 + `white-space: nowrap`.

- **3D Bloch Sphere:** Three.js를 사용하되, 구체(Sphere)의 와이어프레임과 X, Y, Z축은 얇고 은은하게 표현하여 미니멀한 감성을 유지한다. 상태 벡터(화살표)만 토스 블루 컬러로 명확하게 강조한다.
- **컨트롤러 UI:** 각 입력 영역은 독립된 화이트 카드 UI로 감싸고, 슬라이더와 숫자는 직관적으로 매핑한다.
- **코드 파일 구조 규칙:**
  - `index.html`: 메인 웹 페이지 구조 (데스크톱 웹 레이아웃)
  - `style.css`: 토스 스타일 디자인 토큰 및 애니메이션 정의
  - `js/`: Three.js 시각화 로직 및 양자 상태 계산 로직 분리

## 4. 양자 회로 배치 및 상태 시각화 규칙 (IBM Quantum Composer 스타일 확장)

### 4.2. 게이트 팔레트 (원본에서 분할)
- **색상 규칙:** 카테고리 색은 `style.css`의 `:root --cat-*` 변수 한 곳에서만 정의하고, 게이트 버튼과 캔버스 칩은 `cat-<id>` 클래스로 카테고리만 참조한다(버튼별 하드코딩 금지). **Qiskit Composer 계열 색조**(Pauli/Clifford=빨강, Phase/T=하늘색, Rotations=보라, Multi-qubit=진한 파랑, Interaction=청록, Non-unitary=회색, Advanced=어두운 톤)로, 저채도 파스텔 배경 + 진한 텍스트로 WCAG AA(≥4.5:1) 대비를 만족한다(값 교체 시 대비 재계산). gate→카테고리 매핑은 `main.js`의 `GATE_CATEGORY`가 담당(quantum.js의 게이트 정의/시뮬레이션은 건드리지 않음).
- **X 아이콘:** 팔레트의 단독 X 버튼은 문자 "X"로 표시한다(Y·Z와 동일 폰트/크기). ⊕ 기호는 CNOT/CCX 팔레트 버튼의 controlled-NOT 타깃 표시, 그리고 회로 캔버스의 controlled-X·RCCX·RC3X 타깃(quantum.js `targetLabel`)에 쓰인다 — RCCX/RC3X 타깃은 `placed-advanced`(점선 테두리)로 CCX와 시각 구분한다.
- **게이트 툴팁:** 팔레트 칩에 마우스를 올리면 게이트 이름/설명이 커스텀 툴팁으로 표시된다. 툴팁 설명 문구는 모두 영어로 작성한다 (예: H → "Hadamard — creates superposition"). 스크롤 컨테이너에 잘리지 않도록 body에 고정 배치.
- **Measure 아이콘:** Qiskit과 동일한 게이지(반원+바늘+z) SVG 아이콘을 팔레트와 회로 칩 양쪽에 사용한다.
- **버튼 치수(조밀, Quirk 수준):** 버튼 한 변/간격/폰트는 `:root`의 `--gate-size`(**40px**, 모바일 `@media (max-width:640px)`에서 44px 터치 타깃)·`--gate-gap`(4px)·`--gate-font`(12px, 긴 라벨용 `--gate-font-sm` 10px) 변수 한 곳에서 정의하고 나머지는 참조한다(버튼별 하드코딩 금지). 그리드는 `repeat(auto-fill, var(--gate-size))` 고정폭 + `justify-content:start` — 폭이 좁아진 만큼 열이 더 들어가고 버튼은 늘어나지 않아 **정확한 40px 정사각형**(우측은 ragged). 긴 라벨(√X†, RCCX/RC3X)은 `white-space: nowrap`으로 줄바꿈을 막고, 12px에서 다 들어감을 Playwright로 확인(넘치면 그 게이트만 `--gate-font-sm` 적용). 카테고리 헤더 폰트/여백(`--palette-cat-font` 8px·`--palette-cat-gap` 2px·`--palette-section-gap` 4px)도 조여 전체를 조밀하게 — 1600px+ 폭 화면에서 스크롤 없이 한 화면에 들어간다(짧은 창은 팔레트가 구 패널과 세로를 나눠 약간 스크롤될 수 있음).
- **컨트롤 선택 팝오버 UI(다중 선택):** 기존 배치 팝오버(`#place-popover`)의 DOM·스타일을 **그대로 재사용**한다(`.place-popover-title`/`.place-popover-hint`/`.qpick-row`·`.qpick-btn`/`.place-popover-actions`) — 새 컴포넌트를 만들지 않는다. 후보 버튼은 **토글**(`.selected`)이고 첫 후보가 기본 선택된다. 확정은 **Apply**(`pill-btn-primary`, 0개 선택 시 비활성). 키보드는 **방향키(←→↑↓)로 이동 · Space로 토글 · Enter로 확정**(roving `tabindex`; Enter는 `preventDefault`로 버튼 click(=토글)에 새지 않게 하고 확정에 쓴다). Cancel 버튼·**Esc·바깥 클릭으로 취소**. 취소 경로는 컨트롤러를 전혀 호출하지 않으므로 회로와 Undo 스택이 그대로다. Esc/바깥 클릭 처리는 **배치 팝오버와 공통**이라 각도·컨트롤 선택 팝오버 모두에 적용된다. 위치 보정은 공용 `showPopoverAt(clientX, clientY)`.
- **게이트 컨텍스트 메뉴 = 가로 아이콘 바(좌클릭·우클릭 모두):** Show info / Edit parameters / Expand definition / Add control / Remove control / Delete를 **34px 아이콘 6개**로 한 줄에 놓는다(바 높이 42px). 관련끼리 묶어 세로 구분선을 넣고(**[정보·편집] | [제어] | [삭제]**) 파괴적인 Delete는 맨 오른쪽에 분리한다(`.is-danger`로 색도 구분). 메뉴를 열면 그 게이트가 **선택**되고(`.selected` 외곽선) Delete 키의 대상이 된다. 위치는 게이트 위쪽에 띄우되 **화면 밖으로 나가지 않게 좌우·상하를 보정**한다(위 공간이 없으면 아래로 뒤집는다).
  - **아이콘은 인라인 SVG만** 쓴다(이모지는 플랫폼마다 렌더링이 다르고 크기 제어가 안 된다). `svgIcon()` 헬퍼로 24 뷰박스·`stroke-width:1.9`·round 캡을 통일해 한 세트로 보이게 한다. Add/Remove control은 회로 표기 그대로 **•—◯ 연결 + "+"/"−" 배지**로 그린다.
  - **아이콘만으로는 뜻을 알 수 없으므로 툴팁이 필수다**: 모든 버튼에 hover·focus 시 이름(비활성이면 사유)을 **지연 없이** 띄우고 `aria-label`을 반드시 넣는다. 비활성 사유 문구: "No parameters (only RX, RY, RZ, P, U have parameters)" / 기본 게이트는 "Primitive gate — no decomposition" / 분해 정의만 없으면 "No decomposition defined for this gate" / "No free wire in this column" / "This gate has no controls".
  - **비활성 표현에 `disabled` 속성을 쓰지 않는다** — 브라우저가 disabled 요소의 마우스 이벤트를 막아 **사유 툴팁이 아예 뜨지 않기 때문**. `aria-disabled` + `.is-disabled`로 표현하고 클릭만 JS에서 막는다.
  - Esc·바깥 클릭으로 닫고(회로 불변), **좌우 방향키 이동 + Enter/Space 실행**. 비활성 항목도 **건너뛰지 않고 포커스를 받아**(사유 툴팁을 볼 수 있게) 실행만 막힌다 — roving `tabindex`. Add control은 **드롭과 같은 경로**(`controlOptions` → 팝오버) 재사용, Remove control은 제어가 여럿이면 어느 것을 지울지 고르게 한다.
  - **메뉴 항목 클릭은 `stopPropagation`** — 그러지 않으면 그 클릭이 document까지 올라가 방금 연 팝오버/메뉴를 "바깥 클릭"으로 즉시 닫아버린다. 게이트 좌클릭도 같은 이유로 전파를 멈춘다.
- **클릭 동작 + 삭제 경로:** 게이트 본체 좌클릭은 **메뉴 열기**다(예전의 클릭 삭제는 제거). 제어점(•) 클릭은 기존대로 그 제어만 제거한다. 삭제는 메뉴의 Delete **또는 선택 상태에서 `Delete`/`Backspace`**(메뉴가 열린 상태 포함, 입력 필드 포커스 중엔 미개입, Undo 복원 가능).
- **Edit parameters:** 배치 팝오버의 슬라이더 생성부를 `buildSliderRows(names, initialDegrees)`로 공용화해 **현재 값을 초기값으로** 띄우고, 확정 시 `circuit.setParams`(targets/controls 불변, Undo 한 단계).
- **연결선 종점(표준 표기):** `.circuit-grid`는 `isolation:isolate`로 쌓임 맥락을 만들고 `.gate-connector`는 `z-index:-1`로 **셀 아래 레이어**에 그린다 → 박스형 게이트(H,X,Y,…)는 불투명 박스가 선을 덮어 경계에서 끊긴 것처럼 보인다. ⊕(CNOT/Toffoli 타깃)·×(SWAP)는 `.placed-symbol`(배경 투명)이라 선이 기호 중심까지 관통해 보이고, 제어점(●)은 선 위에 얹혀 중심에서 시작·종료한다. 재생 하이라이트(`.step-col-active`)는 반투명이라 연결선이 비쳐 보인다. 연결선 좌표는 `ROW_PITCH/COL_PITCH/CELL_CENTER`(main.js)로 계산하며 셀 높이=행 높이(50)라 세로 오프셋 0.
- **회로 블록 색/크기(팔레트와 2단계 분리):** 회로 캔버스 칩은 `--cat-*-c`(팔레트 파스텔과 같은 색 계열의 진한 solid, 흰 배경 대비 ≥4.5:1)로 **불투명하게 채우고 흰 글자**를 쓴다(`.placed-gate`가 `--gate-c`로 참조). 팔레트 버튼(`.gate-chip.cat-*`)은 파스텔 그대로 — 두 곳이 같은 색 계열로 연결되되 회로 쪽이 진하다. 블록은 40px(팔레트 대비 +~18%), 셀 50px, 세로 피치는 56으로 조여 4~5큐비트가 세로 스크롤 없이, 7단계가 가로 스크롤 없이 들어간다.

### 4.4. 재생/애니메이션 (원본에서 분할)
- **스텝 전환 애니메이션(시각적 트윈만):** 컨트롤러(`circuit.js`)의 play/step은 이전/다음 스텝의 확률·블로흐·스텝열을 담은 `transition` 객체를 `onAnimateStep`으로 넘기고, `main.js`의 `runStepTransition`이 `requestAnimationFrame`으로 트윈한다. **중간 프레임은 실제 양자 상태가 아니라 시각적 보간일 뿐**이다(게이트 유니터리를 U^t로 분수 적용하지 않음, 단순 값 보간). 정확한 상태는 전환이 끝난 뒤 `notify()`로만 표시한다.
  - **확률 막대([2]):** `buildProbTween`이 from/to에서 보이는 상태의 합집합을 한 번 그리고, 매 프레임 막대 높이(path `d`)만 `easeInOutCubic`으로 갱신한다(재구성 없음). 0%↔값 막대도 자연스럽게 생성/소멸.
  - **Bloch([1]):** 화살표는 기존 `animateVectorTo`(slerp, Trail)로 전환 시간만큼 트윈.
  - **Q-sphere([3]):** 위치·색 보간을 하지 않는다. `scene.crossfadeQSphere`가 이전 노드는 제자리에서 투명해지고 새 노드는 제자리에서 나타나는 **짧은 크로스페이드(≤200ms, opacity만)**만 한다.
  - **재생 루프의 예외 격리(중요):** `play`/`stepForward`/`stepBackward`는 **`runPlayback()` 안에서 실행**되고, `finally`에서 **`isPlaying`·`isAnimating`을 반드시 푼 뒤 `notify()`** 한다. 이 불변식이 깨지면 컨트롤러의 모든 뮤테이션이 `if (isAnimating || isPlaying) return`에 걸려 **앱 전체가 조작 불가**가 된다(실제로 유효하지 않은 조건부 회로에서 재생 시 그 버그가 있었다 — `transitionData`가 던진 예외가 루프 밖으로 새면서 플래그가 true로 고정됐다). `catch`는 `console.error`로 원본을 남기고 사유를 `deferredError`로 사용자에게 전달한다. `notify()` 자체도 try/catch로 감싸 **렌더 예외가 컨트롤러 상태를 오염시키지 못하게** 한다. `pause()`는 `notify()`를 호출해야 버튼이 "재생 중"으로 남지 않는다.
  - **사전 차단:** `snapshot.deferredError`가 있으면 재생·스텝 버튼을 막고 **사유를 hover 툴팁**으로 보여준다. 여기서도 `disabled` 속성 대신 **`aria-disabled` + `.is-disabled`**를 쓴다(브라우저가 disabled 요소의 마우스 이벤트를 막아 툴팁이 안 뜨므로) — 클릭은 핸들러에서 막는다. 검증이 통과하면 다음 렌더에서 자동 재활성.
  - **스텝 인디케이터([5]):** 회로 캔버스에 현재 재생 위치를 세로 점선(`.step-indicator`, `translateX`로 부드럽게 이동)으로 표시하고, 적용 중인 열을 하이라이트 밴드(`.step-col-active`)로 강조한다. 정지 상태에서도 `buildCircuitGrid`가 현재 `stepIndex` 위치에 둔다.
  - **속도:** 선택 UI(Slow/Normal/Fast)는 제거했고 기존 **Normal 값으로 고정**한다 — `STEP_DURATION=700` + `STEP_PAUSE=300` ≈ 1초/스텝(예전 500ms보다 느린 이 값을 유지해야 한다). 정지는 컨트롤러 play 루프의 `onStepPause`.
  - **[6]:** 모든 트윈은 rAF 기반(막대는 재구성이 아니라 path 갱신). `prefers-reduced-motion: reduce`면 전환 시간을 0으로(스냅) 하고 CSS 전환도 사실상 끈다.
- 회로 편집(배치/삭제/전체초기화/큐비트 추가삭제/큐비트 탭 전환)은 애니메이션 없이 즉시 스냅한다. 애니메이션은 재생(▶)·스텝 이동(◀/▶|)에서만 발생한다.
- **이동 흔적(Trail):** 벡터가 애니메이션으로 이동할 때마다 지나간 경로를 확률 막대그래프와 동일한 토스 블루(#3182F6, 불투명도 50%, Tube 메쉬)로 구 표면에 남긴다. WebGL은 `Line`의 두께를 대부분 무시하므로 얇은 선이 아닌 Tube 메쉬로 그린다. 재생(▶)을 다시 누르거나 회로 편집/큐비트 탭 전환/처음으로(⏮) 등 상태가 스냅되는 시점에는 흔적을 초기화한다.
- **Trail 점 축적 규칙:** 마지막 저장 점과 사실상 같은 위치(거리² < 1e-6)인 점은 추가하지 않는다. 벡터가 정지한 스텝에서 중복 점이 쌓이면 CatmullRomCurve3의 0-접선 → TubeGeometry NaN으로 궤적이 깜빡이기 때문이다. 화살표가 숨겨지는 길이~0 구간의 점도 스킵한다.

### 4.6. 레이아웃 (데스크톱, 2행×2열, 칼럼-메이저 비대칭)
- 상단에 타이틀 한 줄짜리 축소 헤더.
- 좌상단: 게이트 팔레트 / 우상단: 회로 그리드 / **좌하단: 3D Bloch sphere / 우하단: 확률 그래프**.
- 칼럼-메이저 구조: 왼쪽 칼럼(팔레트+구)은 좁게(기본 27%), 오른쪽 칼럼(회로+확률)은 넓게. 각 칼럼의 상/하 분할 비율은 서로 독립이다 (직사각 타일링 특성상 행별 독립 칼럼 폭과 칼럼별 독립 행 높이는 동시에 가질 수 없어 칼럼-메이저를 채택).
- **Probabilities 패널은 좌우 분할**이다: 왼쪽 확률 차트, 오른쪽 선택 큐비트의 2×2 축소 밀도행렬 뷰(4.12). 확률 그래프는 축이 있는 SVG 막대 차트다(4.15). Y축 Probability(%) 0~100 고정 + 가로 그리드선, X축은 기저 라벨(상태 수에 따라 가로/45°/sparse). Hide 0%·top-N으로 표시 개수를 줄여 한 화면에 담는다.
- 측정 기저(고유벡터) 전개식 |ψ⟩ = Σ cᵢ|i⟩는 Circuit 패널 오른쪽 빈 공간에 표시한다. 외부 수식 라이브러리 없이 앱 기본 폰트(토스 스타일 산세리프)로 렌더링해 UI와 통일감을 유지하며, 계수는 포인트 컬러로 강조한다. 확률이 사실상 0인 항은 생략하고, 재생 스텝/회로 편집 시 확률 막대와 같은 타이밍에 동기화 갱신한다.
- Bloch sphere는 구 1개만 유지하고, q[0]/q[1]/... 탭으로 선택된 큐비트의 벡터를 전환 표시한다.
- 4개 패널의 크기는 드래그로 조정 가능하다. 스플리터는 총 3개: 세로 스플리터(왼쪽↔오른쪽 칼럼, 전체 높이), 왼쪽 칼럼 가로 스플리터(팔레트↔구), 오른쪽 칼럼 가로 스플리터(회로↔확률). 칼럼별 가로 스플리터가 독립적이다 (칼럼 18~55%, 로우 25~75% 범위 제한). 조정한 비율은 `localStorage`(`bloch-layout-v3`)에 저장해 새로고침 후에도 유지한다.

### 4.7. 3D 시각 요소
- 와이어프레임 구와 축은 이전보다 진하게 — 와이어프레임 opacity 0.35 내외, 축은 `Line` 대신 얇은 Cylinder 메쉬로 그려 두께/불투명도를 확실히 제어한다 (WebGL은 `Line`의 linewidth를 대부분 무시하기 때문).
- 라벨 색은 `#4e5968`(본문 텍스트 회색) 수준으로 진하게 (|0⟩, |1⟩ 극 라벨 포함).
- 구의 시점 기본값: 오른쪽에 X축, 왼쪽에 Y축, 위쪽에 Z축이 보이는 구도. OrbitControls로 자유 회전 가능, 리셋 버튼으로 위 초기 시점 복귀.

### 4.9. UI 언어 / 헤더
- 모든 UI 문구(버튼, 툴팁, 상태 표시, 팝오버)는 영어로 통일한다.
- 헤더는 3칼럼 그리드(햄버거 메뉴 | 중앙 제목 | GitHub 링크)로 구성한다. 제목은 "Quantum Tools"이며 항상 가운데 정렬된다.
- 왼쪽 햄버거 버튼은 헤더 바로 아래 메뉴 패널을 열고 닫는다. 향후 이 페이지 외에 더 많은 도구를 다룰 확장을 염두에 두고 있어, 지금은 열림/닫힘 상호작용만 구현하고 내용은 placeholder("More tools coming soon.")로 비워둔다.
- 헤더 오른쪽에 GitHub 저장소(https://github.com/Seolwon64/quantumtools)로 가는 링크(옥토캣 아이콘 + "GitHub")를 배치한다.

### 4.15. 확률 SVG 막대 차트
- **`main.js`의 `renderProbabilities`가 `#prob-list`에 SVG(`buildProbChart`)를 그린다.** 픽셀 공간(clientWidth/Height)으로 렌더하며, 패널 리사이즈·차트 뷰 복귀 시 `ResizeObserver`가 다시 그린다(밀도행렬 뷰에선 생략). 라이트 테마 유지(그리드 `#e6e9ec`, 축 `#c4c9d0`, 텍스트는 ink 토큰).
- **축:** Y축 Probability(%) 0~100 고정, 눈금 0/20/40/60/80/100 + 옅은 가로 그리드선, 회전된 Y축 제목. X축 baseline + 기저 라벨.
- **X축 라벨 전략(`chart.js`의 `pickLabelMode`, 순수·테스트):** 판단 기준은 **Hide 0%·top-N 적용 후 표시 개수**. ≤8 가로, 9~16 45° 회전, ≥17 sparse(인덱스 눈금 `niceTickStep`으로 겹침 없이 + 확률 ≥1% 막대에만 상단 라벨, 나머지는 hover). 밴드가 좁아 겹칠 상황이면 다음 단계로 강등해 **어떤 경우에도 라벨이 겹치지 않는다**.
- **막대:** 윗변 둥근 path(`topRoundedRect`), 밴드폭−2px로 촘촘히. 미샘플링 시 진한 파랑(`#3182f6`). **샘플링 시 이론값=연한 파랑(`#7fb0f7`)+옅은 테두리(relief), 관측값=진한 파랑을 좁게 앞에 겹쳐** 그리고 푸터에 범례(Theoretical/Sampled). 두 계열은 명도로 구분해 CVD-안전(dataviz validator로 검증: 정상 ΔE 15.1, protan 14.3).
- **툴팁:** 각 밴드 전체 높이의 투명 히트영역에 hover하면 리치 툴팁(`.chart-tooltip`)으로 기저 상태·index·이론 확률·관측 횟수(샘플링 시)·진폭(복소수)·위상(도/라디안, `chart.js`의 `phaseInfo`)을 표시한다.
- **유지:** "Hide 0%" 토글과 "N states hidden (X%)"·"Show all N states"는 그대로(4.13). 테스트 `chart.test.mjs`가 `pickLabelMode`·`niceTickStep`·`phaseInfo`를 검증한다.

### 4.11. Bloch 축약상태 / Q-sphere 전환 (원본에서 분할)
- **렌더링(`scene.js`):** 화살표 길이를 |r|에 비례시킨다(`applyArrow`가 `len·SPHERE_RADIUS`). |r|<1이면 반지름 |r|의 **반투명 내부 구**(`innerSphere`, 화살표 끝이 그 표면에 닿음)를 겹쳐 "얼마나 안쪽인지" 보이게 한다. **|r|≈0(<0.02)이면 화살표 대신 원점 점**(`originDot`)을 찍고 DOM 캡션 `#sphere-caption`("Maximally mixed — no local state information")을 구 중앙에 띄운다(점만 있으면 버그로 오인하므로). 순수(|r|>0.999)일 땐 내부 구를 생략한다. 표시 가시성은 `applyBlochVisibility`가 |r| 상태 × 씬 모드로 결정하며 `setMode`도 이를 호출한다.
- **뷰 전환:** 구 패널 왼쪽 아래 `[Bloch | Q-sphere]` 세그먼트 토글(`#view-toggle`). **기본값: 큐비트 1개면 Bloch, 2개 이상이면 Q-sphere**(컨트롤러 생성 후 `setSphereMode`로 1회 적용; 현재 최소 큐비트가 2라 기본은 Q-sphere). Q-sphere는 IBM 스타일로 전체 2ⁿ 계산기저를 구 위에 배치한다: 위도(극각)는 해밍 가중치에 비례, 같은 가중치는 경도에 균등 분산, 마커 크기는 확률, 마커/스템 색상은 위상(HSL). 극 라벨은 |0⟩/|1⟩ ↔ |00…0⟩/|11…1⟩. Q-sphere 모드에서는 큐비트 탭·Bloch 정보 바를 숨기고 "Q-sphere" 타이틀을 표시한다.
- **Q-sphere 유리 구:** 배경은 Bloch 모드의 와이어프레임 대신 유리 같은 반투명 구(`MeshPhysicalMaterial`, transmission·roughness·clearcoat·ior)로 그린다. `PMREMGenerator` + `RoomEnvironment` 환경맵과 ambient/directional/point 조명으로 표면에 하이라이트·음영·입체감이 생긴다(Bloch 모드의 MeshBasic 요소들은 조명·환경맵 영향을 받지 않아 그대로 유지). 구 위에는 경도(longitude) 메리디안, 해밍 가중치별 위도(latitude) 링, 강조된 적도(equator), 극-극 수직 중심축, 항상 카메라를 향하는 외곽 실루엣 원(great-circle billboard)을 은은한 선으로 감싼다. 정적 장식(유리 구·경도·적도·극축·실루엣)은 재생성하지 않고, 위도 링만 별도 서브그룹(`qsphereRingsGroup`)에서 큐비트 수 변경 시 재생성한다. X/Y 축·라벨·Z축 실린더는 Q-sphere 모드에서 숨긴다.
- **상태 노드:** 각 계산기저를 광택 구슬(`MeshStandardMaterial` + emissive, 환경맵 반사)로 표면에 배치한다. 크기는 확률 비례, 색은 위상(HSL 색상환), 중심에서 각 노드로 반투명 색상 스템 라인이 뻗는다.
- **독립 데모:** `qsphere-demo.html`은 CDN(three + OrbitControls + RoomEnvironment) 임포트맵과 더미 중첩 상태로 이 유리 Q-sphere를 단독 실행/미리보기하는 파일이다.
- 각 마커 옆에는 `|비트열⟩ 위상` 라벨을 표시한다(예: `|001⟩ π`). 위상은 π의 간단한 분수(예: π/2, 2π/3)로 근사 표기하고, 맞아떨어지지 않으면 `0.xxπ` 소수로 표기한다. 캔버스로 그리는 모든 3D 라벨(Bloch/Q-sphere/Cityscape 공통)은 `index.html`의 `html, body` font-family와 정확히 같은 폰트 스택을 써서 DOM 텍스트와 글꼴이 어긋나지 않게 한다.
- State/Phase angle 체크박스는 미니멀 원칙에 맞지 않아 제거했다 — 마커와 스템 라인은 Q-sphere 모드에서 항상 함께 표시된다. 그 대신 구 패널 오른쪽 아래(경고 아이콘과 배타적으로 같은 자리)에 위상→색상 범례(작은 색상환 + 0/π/2/π/3π/2 눈금만, "Phase" 텍스트 라벨 없이)를 표시한다.
- Bloch ↔ Q-sphere 토글 버튼은 라벨 텍스트("Bloch"/"Q-sphere") 길이가 달라도 버튼 크기가 변하지 않도록 고정 높이·고정 라벨 너비를 준다 (전환할 때 아이콘이 움찔거리며 위치가 밀리는 문제 방지).