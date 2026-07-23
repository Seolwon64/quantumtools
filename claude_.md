# 프로젝트 지침서: 토스 스타일 블로흐 구 시각화 웹앱

## 1. 프로젝트 개요
- **목표:** 양자 큐비트 상태(Bloch Sphere)를 토스(Toss) 앱처럼 직관적이고 친근하며 극도로 미니멀한 UI/UX로 시각화하는 인터랙티브 웹앱 구현.
- **핵심 기술 스택:** HTML5, CSS3, JavaScript (Three.js 기반 3D 렌더링).
- **플랫폼:** 데스크톱(PC) 웹 전용. 모바일 웹 대응은 고려하지 않는다.

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
- **3D Bloch Sphere:** Three.js를 사용하되, 구체(Sphere)의 와이어프레임과 X, Y, Z축은 얇고 은은하게 표현하여 미니멀한 감성을 유지한다. 상태 벡터(화살표)만 토스 블루 컬러로 명확하게 강조한다.
- **컨트롤러 UI:** 각 입력 영역은 독립된 화이트 카드 UI로 감싸고, 슬라이더와 숫자는 직관적으로 매핑한다.
- **코드 파일 구조 규칙:**
  - `index.html`: 메인 웹 페이지 구조 (데스크톱 웹 레이아웃)
  - `style.css`: 토스 스타일 디자인 토큰 및 애니메이션 정의
  - `js/`: Three.js 시각화 로직 및 양자 상태 계산 로직 분리

## 4. 양자 회로 배치 및 상태 시각화 규칙 (IBM Quantum Composer 스타일 확장)

### 4.1. 큐비트
- 사용자가 큐비트 와이어를 직접 추가/삭제할 수 있다. 최소 2개, 최대 6개 (q[0] ~ q[5]). 저장된 회로가 없을 때의 기본 시작값은 4개.
- 전역 상태는 2ⁿ차원 복소 상태벡터로 관리한다 (n = 현재 큐비트 수). Bloch sphere는 매 순간 "선택된 큐비트 1개"의 축약밀도행렬(partial trace)로부터 계산한 벡터를 그린다. 얽힘이 생기면 그 큐비트의 벡터 길이가 1보다 작아지며 구 안쪽으로 들어가는 것을 정상 동작으로 인정한다.

### 4.2. 게이트 팔레트 (카테고리 그룹 + 색상 코딩)
- **카테고리 구성(표시 계층 전용, `main.js`의 `PALETTE_CATEGORIES`):** 팔레트는 카테고리별 섹션으로 묶고, 각 섹션 상단에 카테고리 이름 라벨을 작게 붙인다(색상만으로는 색각 이상 사용자가 구분하기 어려우므로 필수). 카테고리:
  - Pauli & Clifford: H, X, Y, Z, I, S, S†, √X, √X†
  - Phase / T: T, T†, P
  - Rotations: RX, RY, RZ, U  (RZ는 회전 게이트로 분류)
  - Multi-qubit: **Control(• Control, 맨 앞)**, CNOT, CCX, SWAP, CSWAP
  - Interaction: RXX, RYY, RZZ  (세 pair-param 게이트는 한 세트)
  - Non-unitary(회색): Measure, Reset, Barrier
  - **Advanced · relative phase**: RCCX, RC3X — 상대위상 Toffoli(Margolus) 변형. 정확한 CCX/C3X가 **아니므로** 초심자가 혼동하지 않게 별도 카테고리로 분리하고, 경고 톤 배경 + 점선 테두리(`cat-advanced`)로 시각 구분한다.
- **색상 규칙:** 카테고리 색은 `style.css`의 `:root --cat-*` 변수 한 곳에서만 정의하고, 게이트 버튼과 캔버스 칩은 `cat-<id>` 클래스로 카테고리만 참조한다(버튼별 하드코딩 금지). 저채도 파스텔 배경 + 진한 텍스트로 WCAG AA(≥4.5:1) 대비를 만족한다. gate→카테고리 매핑은 `main.js`의 `GATE_CATEGORY`가 담당(quantum.js의 게이트 정의/시뮬레이션은 건드리지 않음).
- **X 아이콘:** 팔레트의 단독 X 버튼은 문자 "X"로 표시한다(Y·Z와 동일 폰트/크기). ⊕ 기호는 CNOT/CCX 팔레트 버튼의 controlled-NOT 타깃 표시, 그리고 회로 캔버스의 controlled-X·RCCX·RC3X 타깃(quantum.js `targetLabel`)에 쓰인다 — RCCX/RC3X 타깃은 `placed-advanced`(점선 테두리)로 CCX와 시각 구분한다.
- **if 블록:** 미구현이므로 `main.js`의 `GATE_ENABLED = { IF: false }` 피처 플래그로 렌더링에서만 제외한다(GATE_INFO 정의/엔진 코드는 유지).
- **게이트 툴팁:** 팔레트 칩에 마우스를 올리면 게이트 이름/설명이 커스텀 툴팁으로 표시된다. 툴팁 설명 문구는 모두 영어로 작성한다 (예: H → "Hadamard — creates superposition"). 스크롤 컨테이너에 잘리지 않도록 body에 고정 배치.
- **Measure 아이콘:** Qiskit과 동일한 게이지(반원+바늘+z) SVG 아이콘을 팔레트와 회로 칩 양쪽에 사용한다.
- **버튼 치수:** 버튼 한 변/간격/폰트는 `:root`의 `--gate-size`(56px)·`--gate-gap`·`--gate-font` 변수 한 곳에서 정의하고 나머지는 참조한다(버튼별 하드코딩 금지). 그리드 열은 고정하지 않고 `repeat(auto-fill, minmax(var(--gate-size), 1fr))`로 컨테이너 폭에 맞춰 자동으로 채운다. 긴 라벨(√X†, RCCX)은 `white-space: nowrap`으로 줄바꿈을 막고, 넘칠 경우 폰트가 아니라 `--gate-size`를 키운다. 카테고리 헤더 폰트/여백도 버튼에 맞춰 작게(`--palette-cat-font` 등) 유지한다.
- CZ는 팔레트에서 제외(엔진은 유지). 마지막 파이 아이콘은 확률 표시 위젯이라 자체 Probabilities 패널로 대체.
- **비트 순서(endianness) 라벨:** 상태벡터/확률 표기는 little-endian(q0이 오른쪽 끝, Qiskit 관례)이다. 이를 명시하기 위해 Probabilities 패널 제목 옆과 상태벡터 수식(|ψ⟩=…) 아래에 `|q(n-1) … q1 q0⟩` 형태의 작은 회색 라벨을 표시한다(큐비트 수에 따라 자동 갱신, hover 시 "Little-endian: q0 is the rightmost bit (Qiskit convention)" 툴팁). `main.js`의 `endianLabelText(n)`가 생성.
- **단일 큐비트:**
  - 고정 게이트: H, X, Y, Z, S, S†, T, T†, I, √X, √X† — 즉시 드래그 배치.
  - 파라미터 게이트: RX, RY, RZ, P — 드롭 시 각도(0~360°) 슬라이더 팝오버로 확인 후 배치. U는 θ, φ, λ 3개 슬라이더.
- **다중 큐비트:** 드롭 시 팝오버에서 관여할 큐비트를 선택해 배치한다.
  - CNOT(컨트롤 1개), CZ(컨트롤 1개) — 내부적으로 base 게이트(X/Z) + 컨트롤 부여로 실행.
  - **CSWAP(Fredkin, `kind:"cswap"`)** — 드롭한 행이 첫 swap 타깃, 팝오버에서 **swap 파트너 1개 + 컨트롤 1개**를 각각의 행에서 고른다. CNOT/CCX 프리셋과 동일하게 놓는 순간 canonical `{gate:"SWAP", targets:[home, partner], controls:[c]}`로 전개된다(엔진은 SWAP+controls를 이미 일반 처리). 표기는 •—×—×, hover 시 "CSWAP (Fredkin)".
  - **RCCX(관여 3개)·RC3X(관여 4개)** — 드롭한 행이 타깃, 팝오버에서 컨트롤 2/3개를 고른다. `controls` 경로를 타지 **않고** `{gate, targets:[...controls, target], controls:[]}`로 저장하며, `quantum.js`의 `applyRCCX`/`applyRC3X`가 H/T/T†/CX **분해**로 정확한 상대위상 유니터리를 적용한다(8×8/16×16 하드코딩 없음). CCX/C3X와 상대위상만큼 달라 수학적으로 구분된다.
  - SWAP(파트너 1개), RXX/RYY/RZZ(파트너 1개 + 각도 θ). RYY(θ)=exp(−i θ/2 Y⊗Y)는 RXX와 같은 쌍 회전이나 코너쌍 |00>↔|11>이 +i·sin(RXX는 −i·sin) — `applyRYY`가 코너/중간쌍 부호(s)로 구분.
  - **팝오버 픽커는 role별 독립 행**이다: swap 파트너 행과 컨트롤 행을 따로 렌더하고 서로 겹치지 않게 선택한다(CSWAP는 두 행 모두 표시, CNOT/CCX/RCCX는 컨트롤 행만).
  - 팔레트에서 큐비트 수가 부족한 게이트(RCCX는 3개, RC3X는 4개 필요)는 비활성 표시.
- **Control(• Control) 부착 UI:** 팔레트 "• Control" 버튼(Multi-qubit 맨 앞)을 캔버스 셀에 드롭하면 같은 칼럼에서 가장 가까운 게이트의 `controls` 배열에 그 큐비트가 추가된다(모델만 수정, 시뮬레이션 코드 불변). 같은 칼럼에 게이트가 없거나 대상이 Measure/Reset/Barrier면 거부하고 이유를 툴팁으로 표시한다. 제어점을 클릭하면 그 제어만 제거, 타깃 게이트를 클릭하면 게이트 전체 제거. CNOT/CCX 프리셋 버튼도 유지되며, 드롭 시 수동 부착과 **완전히 동일한** canonical 데이터(X+controls)로 전개된다. 단, **RCCX/RC3X에는 "• Control" 부착을 거부한다**(분해가 이미 고정되어 컨트롤을 더할 수 없음) — 이유를 툴팁으로 표시.
- **컨트롤 렌더링:** 제어점과 타깃을 세로 실선으로 잇는다. 표준 표기 — controlled-Z는 양쪽 채운 점(•—•), controlled-SWAP는 •—×—×, controlled-X는 •—⊕. 제어가 붙은 게이트에 hover하면 표준 이름(X+1→"CX (CNOT)", Z+1→"CZ", X+2→"CCX (Toffoli)", SWAP+1→"CSWAP (Fredkin)", P+1→"CP", RZ+1→"CRZ", X+3↑→"MCX", Z+3↑→"MCZ", 매핑 없으면 "Controlled-<gate>")을 툴팁으로 보여준다.
- **레거시 CTRL 셀:** 예전 방식의 칼럼 단위 CTRL 점(`{gate:"CTRL"}` 셀)도 여전히 시뮬레이션·렌더링되지만, 새 "• Control" 드롭은 이제 `controls` 배열에 직접 부착한다.
- **구조 게이트:** Barrier·Measure는 상태를 바꾸지 않는 시각 요소(no-op), Reset(|0⟩)은 4.5의 결정론적 사영.
- **제외:** If(고전 조건부 실행) — 실제 확률적 측정 붕괴 없이는 의미가 성립하지 않아 팔레트에서 제외한다.
- **다중 큐비트 게이트 렌더링:** placement는 타겟 큐비트 셀에 저장하고, 관여하는 와이어 사이를 세로 연결선으로 잇는다. 컨트롤은 점(●), SWAP 파트너는 ×로 표시. 관여한 아무 칸이나 클릭하면 placement 전체가 삭제된다.

### 4.3. 회로 편집 방식 / 데이터 모델
- **정규(canonical) placement 셀:** `{ gate, targets:number[], controls:number[], params:{} }`. 모든 게이트가 임의 개수의 컨트롤을 가질 수 있다. CNOT=`{gate:"X",controls:[c]}`, CCX=`{gate:"X",controls:[c0,c1]}`, CZ=`{gate:"Z",controls:[c]}`, CSWAP=`{gate:"SWAP",targets:[a,b],controls:[c]}`. 셀은 홈 행(=`targets[0]`, `grid[col][targets[0]]`)에만 저장하고 나머지 관여 큐비트는 필드로 기록한다.
- **상대위상 게이트(RCCX/RC3X, `kind:"decomposed"`):** 컨트롤 경로를 타지 않고 관여 큐비트를 전부 `targets`에 담는다 — RCCX=`{gate:"RCCX", targets:[a,b,t], controls:[]}`(a,b=컨트롤, t=타깃, **target은 항상 마지막**), RC3X=`{gate:"RC3X", targets:[a,b,c,t], controls:[]}`. 홈은 `targets[0]`(=첫 컨트롤)이라 단일 타깃 게이트와 달리 드롭 행과 다르다 — `placeGate`는 `grid[col][cell.targets[0]]`에 저장한다. `isValidPlacement`는 `TARGET_COUNT`로 타깃 개수(RCCX 3, RC3X 4)를 검증하고 `controls.length===0`을 강제한다. 렌더링은 마지막 target을 ⊕(placed-advanced), 앞쪽을 컨트롤 점으로 그린다.
- **시뮬레이션 엔진(`quantum.js applyPlacement`)은 컨트롤을 일반적으로 처리한다:** n개 컨트롤 = "모든 control 비트가 1인 기저 상태 쌍에만 base 게이트 적용"(`applyUnitary`의 controlMask). 게이트별 컨트롤 특수 분기는 없다. 순수 함수 `circuit.js simulate(qubitCount, grid, steps)`가 그리드→상태벡터를 계산한다.
- **제약:** Measure/Reset/Barrier/CTRL은 컨트롤을 붙일 수 없다. `isValidPlacement`가 거르고, `applyPlacement`는 위반 시 `"<gate> cannot be controlled"` 에러를 던진다.
- **하위 호환:** 구버전 셀(`{gate:"CNOT", controls, partner}`)은 `migrateCell`이 canonical로 변환한다. localStorage 로드·URL 디코드 시 자동 마이그레이션되며, 배포된 v:1 URL은 `decodeCircuit`의 v:1 분기로 계속 열린다(현재 인코딩은 v:2). **RCCX/RC3X는 v:1에서 `gate`명이 보존되므로**(`{g:"RCCX", x:[a,b]}`) `migrateCell`의 `decomposed` 분기가 `targets:[a,b,homeRow]`로 정확히 복원한다 — 예전처럼 CCX로 흡수되지 않는다. v:1 디코드는 홈=`targets[0]`에 저장한다. QASM/Qiskit export는 controls 패턴을 표준명으로 역매핑하되(X+1→cx, Z+1→cz, X+2→ccx, X+n→Qiskit mcx, 미지원 조합은 주석), **RCCX/RC3X는 역매핑보다 먼저 고유 분기로** `rccx`/`rc3x`(Qiskit `qc.rccx`/`qc.rcccx`)로 내보낸다(ccx로 잘못 나가지 않음). CTRL(•) 칼럼 수정자는 export하지 않는다.
- **테스트:** `test/` 디렉터리(`node --test test/*.test.mjs`로 실행 — 이 Node 버전은 디렉터리 인자를 모듈 경로로 오인하므로 glob으로 파일들을 넘긴다). `circuit-refactor.test.mjs`: CNOT/CCX/CZ 동작, 컨트롤 미만족 불변, 마이그레이션 회귀, 구 URL 복원, 제약 에러, export 역매핑을 검증한다. **RCCX/RC3X:** 8/16개 기저 정확 진폭(RCCX |011>→+i|111>, |101>→−1, |111>→−i|011> 등), 유니터리성 U†U=I, RCCX≠CCX, H⊗H⊗H 후 상대위상 3개(π/2·π·3π/2), 구 v:1 URL 복원, `rccx` export를 검증한다. **RYY:** RYY(π/2)|00>=(|00>+i|11>)/√2(Qiskit RYYGate 일치)·|01>=(|01>−i|10>)/√2·유니터리성·`ryy` export. **CSWAP:** control q0=1이면 q1,q2 교환·control=0 불변·프리셋 migrateCell→SWAP+controls·`cswap` export. `probabilities.test.mjs`: `computeVisibleProbabilities`의 영확률 숨김·임계값 경계·숨긴 개수/확률·6큐비트 top-N cap·showAll·observed 예외·index 순서 보존을 검증한다. `sampling.test.mjs`: `sampleCounts`의 합=shots·확률0 미샘플링·shots=1 단일 기저·정규화(합≠100)·H 50/50 근사(정확히 512 아님)·seed 결정론/변동성을 검증한다. `history.test.mjs`: Undo/Redo(배치·제거·Clear undo·큐비트수·제어·redo 무효화·비변경 제외·50 제한·no-op·스냅샷 격리).
- 회로는 큐비트(행) × 시간 칼럼(열)의 그리드다. 최대 열 개수는 12개.
- 배치: 팔레트에서 게이트를 그리드 셀로 드래그 앤 드롭.
- 삭제: 배치된 게이트 칩을 클릭하면 즉시 제거된다 ("마지막 삭제" 대신 임의 위치 직접 삭제). 별도로 "전체 삭제" 버튼을 제공한다.
- 큐비트를 추가/삭제하면 기존 배치는 유지되며(삭제된 큐비트의 게이트만 함께 사라짐), 즉시 결과 상태로 스냅한다.
- **Undo/Redo(히스토리):** 컨트롤러 내부에 `undoStack`/`redoStack`을 둔다. 회로를 바꾸는 모든 뮤테이션(placeGate/removeGate/addControl/removeControl/clear/setQubitCount)이 **변경 직전** `pushUndo()`로 전체 스냅샷(`{qubitCount, grid}` 딥클론)을 저장한다(diff 아님). 검증에 실패해 early-return하는 경로에서는 push하지 않아 빈 히스토리가 쌓이지 않는다. 최대 `MAX_HISTORY=50`단계, 초과 시 오래된 것부터 버린다. **재생 위치 이동(reset/step/play)·큐비트 탭 선택(selectQubit)은 히스토리에 쌓지 않는다.** `undo()`/`redo()`는 현재 상태를 반대 스택에 넣고 스냅샷을 복원한 뒤 `notify()`한다(뷰/재생 상태는 clamp만). `Clear all`도 되돌릴 수 있어야 하는 것이 주 목적. snapshot에 `canUndo`/`canRedo`를 노출해 버튼 활성/비활성을 제어한다.
- **Undo/Redo UI:** Circuit 툴바(큐비트 스테퍼 오른쪽)에 ↰/↱ 아이콘 버튼. 단축키 `Ctrl+Z`(실행취소)·`Ctrl+Shift+Z`(다시실행), Mac은 `Cmd`. `e.target`이 INPUT/TEXTAREA/SELECT/contentEditable이면 가로채지 않는다(텍스트 편집 우선). 스택이 비면 버튼 비활성(`.icon-btn:disabled` opacity 0.35). 테스트: `history.test.mjs`(배치·제거·clear undo·큐비트수·제어 add/remove·redo 무효화·비변경 제외·50 제한·빈 스택 no-op·스냅샷 오염 방지, 11개).

### 4.4. 재생/애니메이션
- 재생 단위는 "칼럼"이다. 한 스텝 = 해당 칼럼에 있는 모든 큐비트의 게이트를 동시 적용.
- 상태 벡터는 구면보간(Slerp)으로 이동, 500ms, ease-out. 재생은 마지막 칼럼까지 진행 후 정지(반복 없음).
- 회로 편집(배치/삭제/전체초기화/큐비트 추가삭제/큐비트 탭 전환)은 애니메이션 없이 즉시 스냅한다. 애니메이션은 재생(▶)·스텝 이동(◀/▶|)에서만 발생한다.
- **이동 흔적(Trail):** 벡터가 애니메이션으로 이동할 때마다 지나간 경로를 확률 막대그래프와 동일한 토스 블루(#3182F6, 불투명도 50%, Tube 메쉬)로 구 표면에 남긴다. WebGL은 `Line`의 두께를 대부분 무시하므로 얇은 선이 아닌 Tube 메쉬로 그린다. 재생(▶)을 다시 누르거나 회로 편집/큐비트 탭 전환/처음으로(⏮) 등 상태가 스냅되는 시점에는 흔적을 초기화한다.
- **Trail 점 축적 규칙:** 마지막 저장 점과 사실상 같은 위치(거리² < 1e-6)인 점은 추가하지 않는다. 벡터가 정지한 스텝에서 중복 점이 쌓이면 CatmullRomCurve3의 0-접선 → TubeGeometry NaN으로 궤적이 깜빡이기 때문이다. 화살표가 숨겨지는 길이~0 구간의 점도 스킵한다.

### 4.5. 측정/Reset에 대한 결정론적 근사
- 실제 무작위 붕괴(collapse)는 구현하지 않는다. Measure는 "그 시점까지의 확률 분포 확정"만 의미하며 상태를 바꾸지 않는다.
- Reset(|0⟩)을 도입할 때는 항상 |0⟩ 분기로 결정론적 사영(projection) 후 재정규화한다. 얽히지 않은 큐비트에는 정확하고, 얽힌 큐비트에는 근사임을 인지한다.

### 4.6. 레이아웃 (데스크톱, 2행×2열, 칼럼-메이저 비대칭)
- 상단에 타이틀 한 줄짜리 축소 헤더.
- 좌상단: 게이트 팔레트 / 우상단: 회로 그리드 / **좌하단: 3D Bloch sphere / 우하단: 확률 그래프**.
- 칼럼-메이저 구조: 왼쪽 칼럼(팔레트+구)은 좁게(기본 27%), 오른쪽 칼럼(회로+확률)은 넓게. 각 칼럼의 상/하 분할 비율은 서로 독립이다 (직사각 타일링 특성상 행별 독립 칼럼 폭과 칼럼별 독립 행 높이는 동시에 가질 수 없어 칼럼-메이저를 채택).
- 확률 그래프는 2ⁿ개 계산기저를 생략 없이 세로 막대그래프(bar chart)로 전부 보여준다. 막대 개수가 많아지면 가로 스크롤로 확장한다.
- 측정 기저(고유벡터) 전개식 |ψ⟩ = Σ cᵢ|i⟩는 Circuit 패널 오른쪽 빈 공간에 표시한다. 외부 수식 라이브러리 없이 앱 기본 폰트(토스 스타일 산세리프)로 렌더링해 UI와 통일감을 유지하며, 계수는 포인트 컬러로 강조한다. 확률이 사실상 0인 항은 생략하고, 재생 스텝/회로 편집 시 확률 막대와 같은 타이밍에 동기화 갱신한다.
- Bloch sphere는 구 1개만 유지하고, q[0]/q[1]/... 탭으로 선택된 큐비트의 벡터를 전환 표시한다.
- 4개 패널의 크기는 드래그로 조정 가능하다. 스플리터는 총 3개: 세로 스플리터(왼쪽↔오른쪽 칼럼, 전체 높이), 왼쪽 칼럼 가로 스플리터(팔레트↔구), 오른쪽 칼럼 가로 스플리터(회로↔확률). 칼럼별 가로 스플리터가 독립적이다 (칼럼 18~55%, 로우 25~75% 범위 제한). 조정한 비율은 `localStorage`(`bloch-layout-v3`)에 저장해 새로고침 후에도 유지한다.

### 4.7. 3D 시각 요소
- 와이어프레임 구와 축은 이전보다 진하게 — 와이어프레임 opacity 0.35 내외, 축은 `Line` 대신 얇은 Cylinder 메쉬로 그려 두께/불투명도를 확실히 제어한다 (WebGL은 `Line`의 linewidth를 대부분 무시하기 때문).
- 라벨 색은 `#4e5968`(본문 텍스트 회색) 수준으로 진하게 (|0⟩, |1⟩ 극 라벨 포함).
- 구의 시점 기본값: 오른쪽에 X축, 왼쪽에 Y축, 위쪽에 Z축이 보이는 구도. OrbitControls로 자유 회전 가능, 리셋 버튼으로 위 초기 시점 복귀.

### 4.8. 지속성
- 큐비트 수와 회로 그리드 배치는 `localStorage`에 저장하여 새로고침 후에도 유지한다. 재생 진행 상태(스텝 위치)는 저장하지 않고 항상 완성된 최종 상태로 복원한다.

### 4.9. UI 언어 / 헤더
- 모든 UI 문구(버튼, 툴팁, 상태 표시, 팝오버)는 영어로 통일한다.
- 헤더는 3칼럼 그리드(햄버거 메뉴 | 중앙 제목 | GitHub 링크)로 구성한다. 제목은 "Quantum Tools"이며 항상 가운데 정렬된다.
- 왼쪽 햄버거 버튼은 헤더 바로 아래 메뉴 패널을 열고 닫는다. 향후 이 페이지 외에 더 많은 도구를 다룰 확장을 염두에 두고 있어, 지금은 열림/닫힘 상호작용만 구현하고 내용은 placeholder("More tools coming soon.")로 비워둔다.
- 헤더 오른쪽에 GitHub 저장소(https://github.com/Seolwon64/quantumtools)로 가는 링크(옥토캣 아이콘 + "GitHub")를 배치한다.

### 4.10. 회로 공유 / 내보내기 (`js/export.js`)
- **URL 공유:** 회로(큐비트 수 + 배치)를 JSON→base64url로 인코딩해 `#c=...` 해시로 표현한다. 공유 버튼(링크 아이콘)이 현재 회로의 공유 URL을 클립보드에 복사한다. 페이지 로드 시 해시가 있으면 localStorage보다 우선 적용하고, 이후 편집이 오래된 해시로 되돌아가지 않도록 즉시 해시를 제거한다.
- **내보내기:** 내보내기 버튼(코드 아이콘) → 메뉴에서 "Copy OpenQASM 2.0" / "Copy Qiskit (Python)" 선택 시 해당 코드가 클립보드에 복사된다. Control(•) 칼럼 수정자는 표준 표현이 없어 내보내지 않고 주석으로 명시한다. RC3X는 Qiskit에서 `rcccx` 메서드로 매핑.
- 공유/내보내기 버튼은 Circuit 패널 툴바에 두고, 복사 완료는 하단 토스트로 알린다.

### 4.12. Density Matrix Cityscape (`js/cityscape.js`)
- Probabilities 패널 제목 오른쪽에 상호작용 스위치가 있어, 누르면 세로 막대그래프와 Density Matrix Cityscape가 서로 전환된다(패널 제목도 "Probabilities" ↔ "Density Matrix"로 바뀐다).
- **밀도행렬 계산:** `quantum.js`의 `densityMatrix(state)`가 상태벡터의 외적 ρ = |ψ⟩⟨ψ| (`rho[i][j] = ψ_i · conj(ψ_j)`)을 전체 2ⁿ×2ⁿ로 계산한다. 대각(확률)뿐 아니라 off-diagonal coherence(간섭)를 모두 포함하며, 큐비트 수가 바뀌면 `matrix.length`(=2ⁿ)에 따라 격자가 동적으로 확장된다.
- **렌더링:** Re(ρ)와 Im(ρ)를 동시에 좁게 붙이지 않고, 세그먼트 토글(제목 오른쪽 Re/Im, cityscape 모드에서만 표시)로 **한 번에 하나만 크게** 표시한다. 막대는 바둑판(n×n `LineSegments` 격자선) 위에 세우며, 격자선은 y를 살짝 내려(GRID_Y) 막대 밑면과의 z-fighting("지지직")을 방지한다(반투명 coplanar 평면은 쓰지 않는다). 양수=토스 블루, 음수=빨강, 높이는 |ρ| 전체 최대 절댓값 기준으로 정규화(Re/Im 스케일 일관). n≤4일 때 행/열 축에 기저 라벨(|00…⟩)을 표시한다. Cityscape 씬은 처음 전환될 때 생성한다(숨겨진 컨테이너는 크기가 0이라 미리 만들면 카메라 비율이 깨짐).

### 4.13. Probabilities 표시 필터 ("Hide 0%")
- **`quantum.js`의 순수 함수 `computeVisibleProbabilities(probabilities, { hideZero, threshold, qubitCount, topN, showAll, observed })`**가 표시할 상태를 계산한다(DOM 무관, `test/probabilities.test.mjs`로 검증). 반환: `{ visible, hiddenZeroCount, hiddenZeroProb, cappedCount, capActive, totalCount }`.
- **Hide 0% 토글**(Probabilities 패널 툴바 오른쪽 체크박스, 기본 켜짐): 확률이 임계값(`threshold=1e-9`, `probability` 필드는 퍼센트라 `p/100 ≤ threshold`로 비교) 이하인 기저 상태를 목록에서 제외하고, 푸터(`#prob-footer`)에 "N states hidden (X%)"로 숨긴 개수·확률 합을 표시한다.
- **큐비트 6개 이상**이면 임계값과 무관하게 확률 상위 `PROB_TOP_N=32`개만 표시하고, 나머지는 "Show all N states" 버튼으로 펼친다(펼친 뒤엔 "Show top 32"로 접기). 정렬은 확률 내림차순으로 상위 N을 고르되 렌더는 원래 index 순서를 유지한다.
- **관측 상태(observed)**: 샘플링에서 관측된 기저(count>0)는 어떤 필터(영확률·top-N)로도 숨기지 않는다. `renderProbabilities`가 `sampleResult`에서 관측 집합을 만들어 `computeVisibleProbabilities`에 넘긴다(4.14 참고).
- Density Matrix(cityscape) 뷰에서는 확률 필터가 무의미하므로 토글·푸터·샘플링 컨트롤을 숨긴다. 토글/버튼 조작 시 `renderProbabilities(circuit.getSnapshot())`로 즉시 다시 그린다.

### 4.14. 측정 샘플링 (Run / shots)
- **의미:** 회로 끝(현재 표시 중인 최종 상태벡터) 샘플링이다. **Measure 게이트는 시뮬레이션에서 no-op**(붕괴 없음, [quantum.js](js/quantum.js) `applyPlacement`에서 `return state`)이라 중간 측정은 분포에 영향을 주지 않는다 — 실제 붕괴(per-shot trajectory)는 구현하지 않았다(사용자 승인).
- **순수 함수 `quantum.js`의 `sampleCounts(probabilities, shots, rng = Math.random)`**: `probability`(퍼센트)를 |amp|²로 보고 합으로 나눠 **정규화**한 뒤 누적분포(CDF, 마지막=1로 float 보정)를 만들고, 균등난수로 **이진 탐색**해 shots번 뽑는다. 반환 `counts[i]`(probabilities[i]에 정렬). 확률 0 구간은 CDF가 앞과 같아 절대 선택되지 않는다. `rng` 주입으로 결정론적 테스트(`test/sampling.test.mjs`).
- **UI(Probabilities 툴바):** `shots` 입력(기본 1024, 1~100000 clamp), **Run**·**Reset** 버튼. Run은 현재 분포에서 샘플링해 이론 막대(연한 파랑, 전체폭) 위에 관측 막대(진한 파랑, 좁게 중앙)를 겹쳐 그리고 각 막대에 관측 횟수("261/1024")를 표시한다. Reset은 `sampleResult=null`로 이론값만 보이게 한다(관측이 있을 때만 노출).
- **비동기:** `shots > SAMPLE_CHUNK(10000)`이면 청크로 나눠 `setTimeout(0)`으로 이벤트 루프에 양보하며 누적(UI 프리즈 방지). Run 중엔 버튼 비활성.
- **무효화:** `sampleResult`에 분포 서명(`probSignature` = 큐비트수 + 반올림 확률들)을 함께 저장하고, 회로 편집/스텝/큐비트수 변경으로 서명이 바뀌면 `render()`에서 샘플을 폐기한다(큐비트 탭 선택·Hide 토글 등 분포 불변 동작에서는 유지). 샘플링 중 회로가 바뀌면 결과를 반영하지 않는다(서명 재확인).

### 4.11. Q-sphere 전환 및 얽힘 경고
- Bloch sphere는 순수 단일 큐비트 상태만 정확히 표현하므로, 선택된 큐비트가 다른 큐비트와 얽혀 있으면(축약 벡터 길이 < 0.99) 구 패널 오른쪽 아래에 노란 경고 아이콘이 뜬다. 마우스를 올리면 "Detected entanglement" 말풍선이 표시된다. 경고는 Bloch 모드에서만 뜨고 Q-sphere 모드에서는 숨긴다.
- 구 패널 왼쪽 아래에는 항상(얽힘 여부와 무관하게) Bloch ↔ Q-sphere 토글 스위치가 있다. Q-sphere는 IBM 스타일로 전체 2ⁿ 계산기저를 구 위에 배치한다: 위도(극각)는 해밍 가중치(1인 개수)에 비례, 같은 가중치를 가진 기저들은 경도에 균등 분산, 마커 크기는 확률, 마커/스템 색상은 진폭의 위상(HSL 색상환)을 나타낸다. 극 라벨은 모드에 따라 |0⟩/|1⟩ ↔ |00…0⟩/|11…1⟩로 바뀐다. Q-sphere 모드에서는 큐비트 탭을 숨기고 대신 "Q-sphere" 타이틀을 표시한다(전체 상태 뷰라 개별 큐비트 선택이 의미 없음).
- **Q-sphere 유리 구:** 배경은 Bloch 모드의 와이어프레임 대신 유리 같은 반투명 구(`MeshPhysicalMaterial`, transmission·roughness·clearcoat·ior)로 그린다. `PMREMGenerator` + `RoomEnvironment` 환경맵과 ambient/directional/point 조명으로 표면에 하이라이트·음영·입체감이 생긴다(Bloch 모드의 MeshBasic 요소들은 조명·환경맵 영향을 받지 않아 그대로 유지). 구 위에는 경도(longitude) 메리디안, 해밍 가중치별 위도(latitude) 링, 강조된 적도(equator), 극-극 수직 중심축, 항상 카메라를 향하는 외곽 실루엣 원(great-circle billboard)을 은은한 선으로 감싼다. 정적 장식(유리 구·경도·적도·극축·실루엣)은 재생성하지 않고, 위도 링만 별도 서브그룹(`qsphereRingsGroup`)에서 큐비트 수 변경 시 재생성한다. X/Y 축·라벨·Z축 실린더는 Q-sphere 모드에서 숨긴다.
- **상태 노드:** 각 계산기저를 광택 구슬(`MeshStandardMaterial` + emissive, 환경맵 반사)로 표면에 배치한다. 크기는 확률 비례, 색은 위상(HSL 색상환), 중심에서 각 노드로 반투명 색상 스템 라인이 뻗는다.
- **독립 데모:** `qsphere-demo.html`은 CDN(three + OrbitControls + RoomEnvironment) 임포트맵과 더미 중첩 상태로 이 유리 Q-sphere를 단독 실행/미리보기하는 파일이다.
- 각 마커 옆에는 `|비트열⟩ 위상` 라벨을 표시한다(예: `|001⟩ π`). 위상은 π의 간단한 분수(예: π/2, 2π/3)로 근사 표기하고, 맞아떨어지지 않으면 `0.xxπ` 소수로 표기한다. 캔버스로 그리는 모든 3D 라벨(Bloch/Q-sphere/Cityscape 공통)은 `index.html`의 `html, body` font-family와 정확히 같은 폰트 스택을 써서 DOM 텍스트와 글꼴이 어긋나지 않게 한다.
- State/Phase angle 체크박스는 미니멀 원칙에 맞지 않아 제거했다 — 마커와 스템 라인은 Q-sphere 모드에서 항상 함께 표시된다. 그 대신 구 패널 오른쪽 아래(경고 아이콘과 배타적으로 같은 자리)에 위상→색상 범례(작은 색상환 + 0/π/2/π/3π/2 눈금만, "Phase" 텍스트 라벨 없이)를 표시한다.
- Bloch ↔ Q-sphere 토글 버튼은 라벨 텍스트("Bloch"/"Q-sphere") 길이가 달라도 버튼 크기가 변하지 않도록 고정 높이·고정 라벨 너비를 준다 (전환할 때 아이콘이 움찔거리며 위치가 밀리는 문제 방지).