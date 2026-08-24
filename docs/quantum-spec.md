# 양자 스펙: 회로 데이터 모델 · 게이트 · 측정 · QASM
회로 데이터 모델·게이트 배치·궤적·측정·QASM·직렬화 규격을 담는다.
docs/design-spec.md 를 분할한 것이며 아직 정리 전이라 중복이 남아 있다.

## 3. 기능 및 구현 가이드
### 3.m. 중간 측정이 있으면 **언제나** 궤적으로 계산한다 — Inspect 는 단계별 보기일 뿐
경로 선택은 **회로가 정한다. 사용자 스위치가 아니다.** `needsTrajectorySampling(qubitCount, grid)` 하나가 판정하고 `stateAt`·`validate`·확률 패널·UI 표시가 모두 이 값을 본다.
- **궤적 경로** (중간 붕괴 또는 조건부가 있음): [js/trajectory.js](js/trajectory.js) 의 `runTrajectory` 가 회로를 순차 실행하며 측정에서 실제로 사영·정규화한다. 이후 게이트는 붕괴된 상태 위에서 적용된다.
- **이론 경로** (그 외): MEASURE 는 no-op, 조건부만 양자 제어로 바꾼다([classical.js](js/classical.js)). 붕괴가 없거나 붕괴 뒤에 아무 연산이 없으면 이 값이 **정확**하고 비용이 0이다.

**예전 설계의 실패**: Inspect 가 꺼져 있으면 `h/measure/h/measure` 같은 회로를 지연 측정으로 계산해 `|00⟩ 100%` 를 보여줬다. **그 값은 틀렸다** — 정답은 네 결과 각각 25% 다. "정확한 답을 보려면 스위치를 켜라"는 역할 배분 자체가 잘못이었다. 지금 Inspect 는 **스텝 컨트롤을 여닫는 것**만 한다.
- 측정이 **있는** 회로: Inspect 꺼짐 → 최종 상태만(스텝 컨트롤 숨김). 켜짐 → 스텝 컨트롤 표시. 두 모드가 **같은 캐시 궤적**을 쓰므로 최종 상태가 반드시 일치한다. 끌 때 `stepIndex` 를 끝으로 되돌린다 — 중간 단계에 멈춘 채 컨트롤이 사라지면 되돌릴 방법이 없다.
- 측정이 **없는** 회로: 모든 중간 상태가 결정론적이라 감출 이유가 없다 → **Inspect 토글 자체를 숨기고** 스텝 컨트롤은 늘 보인다.

**확률 패널은 두 분포를 다르게 집계한다** — `aggregateTrajectories` 가 궤적 한 번 순회로 둘 다 만든다.
- **Classical**: 각 궤적의 `clbits` 를 비트열로 **센다**. 측정 결과는 본질적으로 이산적이다.
- **Qubits**: 각 궤적의 최종 순수 상태에서 `|⟨x|ψ_i⟩|²` 를 구해 **평균**한다 — `P(x) = (1/N) Σ_i |⟨x|ψ_i⟩|²`. **궤적마다 기저 하나를 샘플링해 세지 않는다.** 기대값은 같지만 분산이 훨씬 크다. 이 값은 앙상블 **밀도행렬의 대각 성분과 정확히 일치**하고, 측정 없는 회로에서는 모든 궤적이 같아 이론값과 **정확히** 같아진다(테스트가 고정).
- 궤적이 필요 없으면 궤적을 돌리지 않는다. Qubits 는 이론값 그대로, Classical 은 `marginalClassical` 로 이론 확률을 **주변화**한다(비트별 마지막 기록 큐비트 기준) — 붕괴가 없으면 그게 정확하고 비용이 0이다.

**패널 헤더의 `[Classical | Qubits]` 토글** — 측정이 **있을 때만** 보이고 기본은 Classical, 선택은 localStorage(`bloch-prob-view-v1`). 고전 비트만 보면 측정하지 않은 큐비트가 사라지고(텔레포테이션의 q2), 둘 다 그리면 차트가 두 배가 되어 레이아웃에 안 들어간다. **엔디언 라벨이 모드를 항상 드러낸다**: Classical → `|c1 c0⟩`, Qubits → `|q1 q0⟩`. 이 라벨 덕분에 "패널 의미가 회로마다 바뀐다"는 문제가 사라진다. 축 제목도 함께 간다 — 궤적이면 `Probability (% of N shots)`, 이론이면 `Probability (%)`.

**고전 비트 막대에는 진폭도 위상도 없다.** 툴팁에서 `entry.re === null` 이면 Amplitude·Phase 행을 **뺀다**(0 을 넣어 있는 척하지 않는다). 같은 이유로 스텝 전환 트윈은 Classical 모드에서 **그리지 않는다** — 축이 다른 두 분포를 보간하는 셈이라 라벨과 막대가 어긋난다.

**Run / Resample 의 역할 분리** — 둘 다 "다시 뽑기"라 헷갈리기 쉬우므로 무엇을 바꾸는지가 다르다.
| 버튼 | 궤적 회로 | 바꾸는 것 | 바꾸지 않는 것 |
|---|---|---|---|
| `Run` → **`Resample statistics`** | 새 난수 배치로 **재집계** | 확률 패널 | 표시용 궤적 |
| `Resample`(주사위) | 표시용 궤적만 다시 뽑기 | 상태벡터·Q-sphere·블로흐·밀도행렬 | 확률 패널 |

집계 shot 수는 **기존 shots 입력 필드 값을 그대로 쓴다**(별도 상수를 두면 화면의 숫자와 실제 계산이 어긋난다). 궤적이 필요 없는 회로에서는 `Run` 그대로 — 이론값 + 샘플 병기.

**되감기 결정론이 이 설계의 핵심이다.** 매번 새 난수를 뽑으면 스텝 재생이 성립하지 않는다.
- 시드 하나(`trajectorySeed`)를 두고 `makeRng(seed)` 로 결정론적 수열을 만든다. `stateAt(step)` 이 매번 시퀀스를 처음부터 먹이므로 **같은 step 이면 항상 같은 상태**다. 스텝별 캐시가 필요 없다.
- **시드는 회로가 바뀌어도 유지한다.** 게이트를 고쳤을 때 결과가 달라지면 그게 편집 때문인지 새 난수 때문인지 구분할 수 있어야 한다. `Resample` 로만 바뀐다.
- 시드를 localStorage 에 저장하지 않는다 — 새로 열었는데 같은 궤적이면 오히려 혼란스럽다.

**RESET 은 궤적 경로에서만 정확하다.** 기본 경로의 `applyReset` 은 `|0⟩` 성분만 남기는 **사후선택**이라, 얽힌 상대 큐비트의 확률까지 바꾼다(`0.6|00⟩+0.8|11⟩` 에서 q0 리셋 → q1 이 0 으로 확정). 궤적은 측정 후 1 이면 뒤집어 진짜 리셋을 한다.

**조건부는 기록된 고전 비트를 그대로 읽는다.** 지연 측정 변환을 타지 않는다. 아직 기록된 적 없는 비트는 **0(거짓)** — 고전 레지스터는 0 으로 초기화되므로 그게 정확한 의미다(지연 경로는 같은 회로를 에러로 막는다).

**제약이 사라졌다**: 궤적 경로는 `resolveDeferred` 를 아예 타지 않으므로 "측정된 큐비트 재조작" 제약이 없다. 그 제약에 걸리던 회로는 전부 궤적으로 라우팅되므로 **`resolveDeferred` 의 에러는 컨트롤러에서 도달 불가능**하다 — `deferredError` 에 남는 것은 재생 중 예외(`runtimeError`)뿐이다.

**`needsTrajectorySampling` 의 판정 순서가 두 번 틀렸다.**
1. **마지막** 붕괴 기준이라 "측정 → H → 측정" 을 빠른 경로로 잘못 분류했다 → **첫** 붕괴 기준으로 고쳤다.
2. 조건부 검사가 "붕괴 없음" 조기 반환보다 **뒤**에 있었다. 기록된 적 없는 비트를 조건으로 쓰면 지연 변환은 값을 내는 게 아니라 **에러를 낸다** — 그런 회로도 궤적은 정확히 다룬다(조건이 거짓일 뿐). → `hasCondition` 을 **맨 앞**으로 옮겼다.

**성능**: 최악 6큐비트 12열 1024샷 = 46ms. 회로 변경 시 **150ms 디바운스** + `(회로, shots, 배치)` 서명 캐시면 충분하고, 축소 shot 미리보기는 두지 않는다(두 단계 표시는 값이 튀어 보여 오히려 혼란스럽다). 실측: 6큐비트 회로에 게이트 12개를 연속 배치할 때 longtask 12개/최장 177ms 로, **측정 없는 같은 회로(13개/170ms)와 구분되지 않는다** — 집계가 추가 비용을 만들지 않는다.

**`resample()` 은 Inspect 가 꺼져 있어도 알린다.** 예전엔 `if (inspectMode) notify()` 였다. 궤적 경로가 상시가 된 뒤로는 꺼진 상태의 Resample 이 화면을 바꾸지 않은 채 **시드만 조용히 바꿔 놨고**, 나중에 Inspect 를 켜는 순간 상태가 튀었다. 지금은 `needsTrajectorySampling` 이면 알린다(이론 경로에서는 화면이 안 바뀌므로 알리지 않는다). 회귀 테스트로 고정.

### 3.n. 프리셋 검증 원칙
프리셋 회로가 조용히 틀리면 사용자는 알아챌 방법이 없다. `test/presets.test.mjs` 가 **상태벡터를 진폭(실수부·허수부)까지** 대조한다.
- **확률만 보지 않는다.** 위상이 틀려도 확률은 맞을 수 있다. Grover 의 `|11⟩` 은 진폭이 **−1**(위상 π)이고, 그 부호가 곧 오라클+확산이 제대로 돌았다는 증거다.
- **`test/fixtures-baseline.json`** 은 프리셋 상태벡터의 기준선이다. 프리셋을 **의도적으로** 바꿀 때만 그 항목을 갱신한다 — 실제로 QFT 를 바꿨을 때 이 스냅샷이 즉시 잡아냈다.
- **QFT 프리셋은 `|001⟩` 입력이다.** `|000⟩` 에 QFT 를 걸면 위상이 전부 0이라 H⊗H⊗H 와 구별되지 않아 **QFT 의 핵심인 위상 회전이 전혀 드러나지 않는다.** 앞에 `X q[0]` 하나를 두면 위상이 k·π/4 로 균등 증가해 Q-sphere 색상환이 한 바퀴 돈다.
- **W state 의 두 번째 RY 가 π/2 인 것은 어림값이 아니다.** `RY(2·arccos(1/√3)) = 1.910633`(109.47°)이 √(1/3) : √(2/3) 으로 가르고, 이어지는 **controlled-RY(π/2)** 가 남은 2/3 을 정확히 반씩 나눈다.
- **표기 규약을 테스트에 박지 않는다.** Superdense 는 "어느 파울리가 어느 비트열인가"(엔디언·측정 순서에 의존)가 아니라 **네 인코딩이 서로 다른 기저 상태에 100% 로 떨어지는가**를 본다 — 그게 프로토콜이 실제로 주장하는 것이다.
- **위상 비교는 값을 접지 말고 차이를 접는다.** `atan2` 는 −π 와 π 를 같은 점으로 주지 않아, 기대값을 (−π, π] 로 접으면 경계(k=4)에서 오탐이 난다.

### 3.o. QASM / Qiskit 코드 패널
QASM 에 닿는 경로는 **메뉴 → Code editor 하나뿐**이다. 예전 툴바의 `<>` 버튼(클립보드 복사 전용, 화면 표시 없음)은 없앴다 — 경로가 둘이면 어느 쪽이 편집 가능한지 알 수 없다.

**매핑은 `QASM_OPS` 표 하나뿐이다**([js/qasm.js](js/qasm.js)). export 와 parse 가 같은 표를 양방향으로 인덱싱한다. 예전엔 `SIMPLE`·`PARAM`·`qasmControlled()`·`toQASM` 본문 if-else·`controlledQiskit()` **다섯 군데**로 흩어져 있었다 — 역방향 파서가 그 지식을 다시 적으면 export 와 parse 가 조용히 갈라져 왕복이 깨진다.

**정규화 `normalizeCircuit`** 은 export 직전과 왕복 비교에 **같이** 쓴다:
1. 제어점(CTRL)을 같은 열 게이트들의 명시적 `controls` 로 접는다. **예전 export 는 이걸 통째로 버려 제어가 빠진 다른 회로를 내보내고 있었다.**
2. 큐비트별 ASAP 배치로 빈 열을 없앤다.
- **배치 규칙은 `parseQASM` 과 반드시 같아야 한다.** 한쪽이 열 단위 압축, 다른 쪽이 ASAP 이면 정규형이 둘이 되어 왕복 비교가 깨진다.
- **고전 비트도 자원이다.** 이걸 빼먹으면 조건부 게이트가 그 조건을 쓰는 measure **앞으로** 당겨져 인과가 뒤집힌다(왕복 테스트가 실제로 잡았다).

**동기화는 단방향 + 명시적 적용**이다. 회로→코드는 자동, 코드→회로는 Apply / Ctrl·Cmd+Enter 만. 타이핑 중에는 코드가 거의 항상 문법 오류이고, 디바운스를 걸어도 Undo 스택이 타이핑 단위로 오염된다.
- **편집이 없으면 Apply 는 아무 일도 하지 않는다.** `aria-disabled`+`.is-disabled`로 막고(네이티브 `disabled` 는 사유 툴팁을 죽인다) `loadCircuit` 을 부르지 않으므로 `pushUndo` 도 안 일어난다.
- `loadCircuit` 이 `pushUndo` 를 한 번만 부르므로 **Apply = Undo 1단계**가 공짜로 성립한다.
- 정규화가 **실제로 뭔가 바꿨을 때만** 한 줄 안내를 띄운다.
- 편집 중 외부 변경이 오면 덮어쓰지 않고 `Circuit changed. [Reload code] [Keep my edits]`.
- **편집이 시작되면 경고 배너를 감춘다.** 배너는 *우리가 생성한 코드*에 대한 설명인데, 사용자가 손댄 순간 더 이상 그 코드가 아니다. 이걸 안 하면 텔레포테이션에서 코드를 고친 뒤 다른 프리셋으로 바꿔도(modified 라 `refresh` 가 건너뛰어지므로) 조건 경고가 남아 **"superdense 인데 if 경고가 뜬다"** 로 보인다(실제로 겪음).

**파싱은 전부 성공하거나 아무것도 하지 않는다.** `parseQASM` 은 임시 grid 에만 쌓고 마지막에 반환하므로 **부분 적용 경로가 코드에 존재하지 않는다.** 에러는 줄 번호 + 구체적 사유("Not supported: custom gate definitions" 등) — 뭉뚱그린 "syntax error" 를 쓰지 않는다.

**`if` 의 의미가 OpenQASM 과 다르다 — 조용히 넘어가지 않는다.** 이 앱의 `cif = k` 는 "c[k]==1, 나머지 무관"이고 `if (c==N)` 은 레지스터 전체 값이다. 고전 비트가 2개 이상이면 달라진다. 그런데도 그대로 export 하는 이유: 1비트일 때만 내보내면 **텔레포테이션 프리셋이 왕복 불가**가 된다. 대신 **조건이 있고 고전 비트가 2개 이상일 때만** 경고를 붙인다 — 그 외에 띄우면 경고가 배경 소음이 되어 정작 위험할 때 안 읽힌다. 안내는 **코드 문자열 안 주석**과 화면 배너 양쪽에 넣는다(배너는 화면에만 있으므로, Copy 로 붙여넣은 사람도 차이를 알아야 한다).

**에디터는 textarea + 줄번호 거터**다. CodeMirror·Monaco 를 쓰지 않는다. Tab 은 문자 삽입이되 **Shift+Tab 은 포커스 이동으로 남긴다** — 아니면 키보드 사용자가 에디터에 갇힌다.

**패널은 오버레이가 아니라 레이아웃 참여자**다. 왼쪽 열 자리를 차지하고 넓히면(최대 50%) 오른쪽 열이 좁아질 뿐 **Circuit·Probabilities 는 1px도 가려지지 않는다** — 코드를 고치면서 회로·상태벡터·확률을 동시에 보는 게 목적이기 때문. `.ws-left` 는 **DOM 에 남기고 `display:none` 으로만** 숨긴다(Three.js 캔버스가 DOM 에서 빠지면 WebGL 컨텍스트가 손실된다). 숨김 중에는 `scene.setPaused(true)` 로 렌더 루프를 멈추고, **재개 시 `resize()` 를 먼저** 부른다 — 숨김 중엔 `clientWidth` 가 0이라 `resize()` 가 조기 반환해 카메라 aspect 가 낡아 있다.

**파라미터는 1회 왕복 후 고정점**이다(`toFixed(6)`). π/2 → 1.570796 → 1.570796. 표시 각도는 90°·45°·180°·60°·120° 그대로 유지된다.

## 4. 양자 회로 배치 및 상태 시각화 규칙 (IBM Quantum Composer 스타일 확장)

### 4.1. 큐비트
- 사용자가 큐비트 와이어를 직접 추가/삭제할 수 있다. 최소 2개, 최대 6개 (q[0] ~ q[5]). 저장된 회로가 없을 때의 기본 시작값은 4개.
- 전역 상태는 2ⁿ차원 복소 상태벡터로 관리한다 (n = 현재 큐비트 수). Bloch sphere는 매 순간 "선택된 큐비트 1개"의 축약밀도행렬(partial trace)로부터 계산한 벡터를 그린다. 얽힘이 생기면 그 큐비트의 벡터 길이가 1보다 작아지며 구 안쪽으로 들어가는 것을 정상 동작으로 인정한다.

### 4.2. 게이트 팔레트 (원본에서 분할)
- **카테고리 구성(표시 계층 전용, `main.js`의 `PALETTE_CATEGORIES`):** 팔레트는 카테고리별 섹션으로 묶고, 각 섹션 상단에 카테고리 이름 라벨을 작게 붙인다(색상만으로는 색각 이상 사용자가 구분하기 어려우므로 필수). 카테고리:
  - Pauli & Clifford: H, X, Y, Z, I, S, S†, √X, √X†
  - Phase / T: T, T†, P
  - Rotations: RX, RY, RZ, U  (RZ는 회전 게이트로 분류)
  - Multi-qubit: **Control(• Control, 맨 앞)**, CNOT, CCX, SWAP, CSWAP
  - Interaction: RXX, RYY, RZZ  (세 pair-param 게이트는 한 세트)
  - Non-unitary(회색): Measure, Reset, Barrier
  - **Advanced · relative phase**: RCCX, RC3X — 상대위상 Toffoli(Margolus) 변형. 정확한 CCX/C3X가 **아니므로** 초심자가 혼동하지 않게 별도 카테고리로 분리하고, 경고 톤 배경 + 점선 테두리(`cat-advanced`)로 시각 구분한다.
- **if 블록:** 미구현이므로 `main.js`의 `GATE_ENABLED = { IF: false }` 피처 플래그로 렌더링에서만 제외한다(GATE_INFO 정의/엔진 코드는 유지).
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
- **Control(• Control) 부착 UI — 두 경로:** 팔레트 "• Control" 버튼(Multi-qubit 맨 앞)을 캔버스에 드롭한다. 두 경로 모두 컨트롤러의 **단일 변형 지점 `attachControlTo(column, home, controlQubit)`** 만 거치므로, 같은 큐비트를 가리키면 **결과 셀이 완전히 동일**하다(테스트로 고정: 셀 `deepEqual` + `encodeCircuit` 문자열 일치).
  - **빈 칸에 드롭(`addControl`)** — 같은 칼럼에서 **가장 가까운** 게이트의 `controls`에 그 큐비트를 추가한다(제어를 특정 큐비트에 정확히 놓고 싶을 때. 이 최근접 규칙은 회귀 테스트로 고정).
  - **게이트 위에 드롭 → 큐비트 선택 팝오버(다중 선택)** — 그 게이트를 **제어형으로 변환**하되 제어 큐비트를 자동으로 정하지 않고 사용자가 고른다. `controlOptions(column, qubit)`이 **팝오버를 띄우기 전에** 검사하고 후보를 반환한다: 후보 = **같은 열에서 `occupantTarget === -1`인 모든 와이어**를 오름차순으로(게이트 span 안/바깥 구분 없음). `controlOptions`는 **부작용이 없어**(회로·undo 스택 불변) 취소해도 아무 흔적이 남지 않는다. 확정은 `addControlToGate(column, qubit, controlQubits)` — **배열로 여러 개를 한 번에** 받는다(단일 값도 허용). 후보 재검증·중복 검사 후 `attachControlsTo`로 **한 번의 `pushUndo`**에 묶어 붙이므로 몇 개를 고르든 **undo는 한 단계**. 선택 순서와 무관하게 같은 셀이 나오도록 **오름차순 정규화**해서 덧붙인다(기존 `controls`는 재정렬하지 않는다 — 누적 순서/직렬화 출력이 흔들리지 않게). 기존 제어가 있으면 **누적**(덮어쓰지 않음).
    - **후보 1개면 팝오버 없이 즉시 배치**한다(선택지 없는 선택은 불필요한 클릭 — 2큐비트 회로가 대부분 이 경우).
    - 후보 0개 → `"No free wire in this column for a control"`. Measure/Reset/Barrier → `"<gate> cannot be controlled"`, RCCX/RC3X는 `FIXED_MULTI` 문구. 사유는 `controlRejection(cell)` 헬퍼 **한 곳에서만 정의**해 후보 계산과 실제 부착이 어긋나지 않게 한다. 모두 팝오버 없이 툴팁으로 거부.
  - **드롭 지점이 타깃이든 제어점이든 동일하게 처리한다** — CZ는 •—•로 그려져 두 점이 화면상 구별 불가능하고 CCZ는 세 큐비트에 대칭이라 어느 점에 붙여도 결과가 같아야 한다. 후보가 드롭 큐비트가 아니라 **열 전체** 기준이라 구조적으로 동일한 목록·셀이 나온다(전용 정규화 코드 없음). 거부는 **대상 게이트 없는 순수 `CTRL` 셀**에만(`"A control cannot be controlled"`).
- **제어점 드래그 이동은 미구현(별도 작업).** 팝오버로 처음부터 원하는 큐비트를 고를 수 있어 긴급하지 않다. 제어점은 클릭하면 제거된다(기존 동작 유지).
- **게이트 정보 표시(`js/gatematrix.js` + `#gate-info`):** **컨텍스트 메뉴의 "Show info"로만** 연다. hover는 표준 이름 툴팁만(식별용 — 행렬 미리보기는 넣지 않는다), 좌클릭은 메뉴를 열 뿐 정보를 자동으로 띄우지 않는다.
  - 표시 위치는 **왼쪽 Operations 패널**이다. 정보를 보는 동안 팔레트(`.palette-body`)를 감추고 같은 영역에 정보를 그리며, 패널 제목이 "Gate info"로 바뀌고 **X 버튼 또는 Esc로 닫으면 팔레트로 복귀**한다. Circuit 패널 오른쪽은 상태벡터만 보여준다(원래대로).
  - **행렬 계산은 읽기 전용이고 유도하지 않는다:** 관여 큐비트를 로컬 인덱스로 리맵한 뒤 **기저 벡터 e_j를 `applyPlacement`에 통과시켜 j번째 열**을 얻는다 → SWAP·RXX·RCCX처럼 "행렬이 코드에 없는" 게이트도 자동으로 정확하고 분해를 두 번 적을 일이 없다. 엔진·회로는 절대 수정하지 않는다.
  - **로컬 비트 순서 = 실제 큐비트 번호 오름차순**(왼쪽이 작은 번호 = 높은 비트). 역할 순으로 고정하면 RCCX(a,b)와 RCCX(b,a)가 **같은 행렬**이 되어 두 배치의 차이가 사라진다. 큐비트 순이면 컨트롤이 대칭인 CZ·CCX는 그대로, a·b에 비대칭인 RCCX만 달라진다. 이 순서에서 X+컨트롤 1개가 **교과서 CNOT**으로 나온다.
  - **행/열에 기저 켓 라벨**(`basisLabels`)을 붙이고 **대각 성분은 옅은 배경**(`.mx-diag`)으로 구분한다. 밀도행렬 패널의 `.dm-grid` 계열과 같은 시각 언어이되 크기를 일반화한 `.mx-grid`를 쓴다. 라벨이 로컬 기준임을 `localOrder` 캡션(`local |c t⟩ = |q0 q1⟩`)으로 명시한다.
  - **8×8(관여 3큐비트)까지만 렌더링**하고 그 이상은 "Matrix is 16x16 (too large to display)" + 이름·제어 목록·한 줄 설명으로 대체한다(MCX 3제어는 256성분이라 화면에 못 넣는다).
- **[4] Expand definition — 기본은 읽기 전용:** 분해를 정보 패널에 **표시만** 하고, 그 아래 "Apply expansion" 버튼을 눌러야 실제로 교체한다(실수로 회로가 늘어나지 않게). `circuit.expandGate`가 스텝 하나당 한 열을 쓰고 뒤 열들을 밀며, **`pushUndo` 한 번 → Undo 한 단계로 복원**. 분해 정의는 `quantum.js`의 `RCCX_STEPS`/`RC3X_STEPS` **데이터 한 곳**에서 오고 `applyRCCX`/`applyRC3X`도 그걸 순회하므로 시뮬레이션과 표시가 어긋날 수 없다. RC3X는 18스텝이라 `MAX_COLUMNS`(12)에 들어가지 않아 항상 거부된다(사유 표시).
- **컨트롤 렌더링:** 제어점과 타깃을 세로 실선으로 잇는다. 표준 표기 — controlled-Z는 양쪽 채운 점(•—•), controlled-SWAP는 •—×—×, controlled-X는 •—⊕. 제어가 붙은 게이트에 hover하면 표준 이름(X+1→"CX (CNOT)", Z+1→"CZ", X+2→"CCX (Toffoli)", SWAP+1→"CSWAP (Fredkin)", P+1→"CP", RZ+1→"CRZ", X+3↑→"MCX", Z+3↑→"MCZ", 매핑 없으면 "Controlled-<gate>")을 툴팁으로 보여준다.
- **레거시 CTRL 셀:** 예전 방식의 칼럼 단위 CTRL 점(`{gate:"CTRL"}` 셀)도 여전히 시뮬레이션·렌더링되지만, 새 "• Control" 드롭은 이제 `controls` 배열에 직접 부착한다.
- **구조 게이트:** Barrier는 상태를 바꾸지 않는 시각 요소(no-op), Reset(|0⟩)은 4.5의 결정론적 사영. **Measure는 상태벡터를 바꾸지 않는다** — 아래 지연 측정 방식의 핵심 전제다.
- **고전 레지스터 + 지연 측정(`js/classical.js`):** 이 앱은 상태벡터 시뮬레이터라 **중간 측정을 진짜로 수행하면 이후가 혼합 상태가 되어 상태벡터·Q-sphere·축소 밀도행렬·수식 표시가 전부 무의미해진다.** 그래서 **지연 측정 원리**로 계산한다 — 측정을 끝으로 미루고(=Measure를 no-op으로 두고), 고전 조건부 연산을 **양자 제어 게이트로 변환**한다. 최종 측정 통계는 동일하다. 밀도행렬 시뮬레이터나 단일 궤적(난수 붕괴)으로 가지 않는다(전자는 표시가 불가능, 후자는 스텝 되감기·재생이 성립하지 않는다).
  - **`resolveDeferred(qubitCount, clbitCount, grid)`**(순수 함수)가 `params.cif = k`인 셀에 **c[k]에 기록한 큐비트를 controls로 추가**한다. **열 구조를 바꾸지 않으므로** 스텝 재생/되감기 의미가 그대로다. `cif`가 없으면 **원본 그리드를 그대로 반환**해 기존 회로 결과가 비트 단위로 불변이다(테스트가 진폭 실/허수부까지 고정).
  - **거부(조용히 틀린 결과 금지):** 측정된 큐비트를 이후 **타깃**으로 조작하거나 RESET하면 변환이 성립하지 않아 사유와 함께 거부한다. **측정된 큐비트를 제어로 쓰는 것은 허용**한다 — Z기저 측정과 교환되며, 조건부 연산 변환이 정확히 그 형태를 만든다.
  - **에러 처리 규약:** `resolveDeferred`는 `{grid, error}`를, 컨트롤러의 유일한 상태 접근점 `stateAt(step)`은 **`{state, error}`**를, 공개 API `circuit.validate()`는 `addControl`/`setParams`와 같은 **`{ok, reason}`**을 돌려준다. **컨트롤러의 어떤 경로도 예외에 의존하지 않는다.** 순수 함수 `simulate()`는 "상태를 내놓거나 실패하라"는 원시 API라 계속 예외를 던지지만, 컨트롤러는 그 경로로 예외를 받지 않는다. 예상 가능한 실패를 예외로 만들면 호출부마다 try/catch가 필요해지고 하나라도 빠지면 재생 루프가 죽는다(아래 참고).
  - **변환은 딱 한 번만 적용한다:** `simulate` = `resolveDeferred` + `simulateResolved`로 분리했다. 이미 변환된 그리드를 다시 변환하면 조건부 셀에 제어가 중복으로 붙어 **잘못된 검증 실패**가 난다.
  - 기록 없는 c[k]를 조건으로 쓰거나(열 순서 기준), 레지스터 밖 비트를 참조해도 거부한다.
- **데이터 모델:** 셀 구조는 그대로 두고 `params`만 확장한다(targets/controls는 **큐비트 인덱스 전용**이라 고전 비트를 넣으면 안 된다) — Measure는 `params.cbit`(기록 대상), 조건부 연산은 `params.cif`(조건 비트). 컨트롤러가 `clbitCount`(0…6, 기본 = 큐비트 수)를 들고 `setClbitCount`로 바꾸며, 줄일 때 범위 밖 `cbit`/`cif` 참조를 정리한다.
- **`if` 조작:** 팔레트의 `if`를 **이미 배치된 게이트 위에 드롭**해 조건을 붙인다(`•` Control과 같은 방식). 조건 비트는 팝오버에서 고르고, 컨텍스트 메뉴에도 "Add/Change condition"·"Set classical bit"이 있다. (`GATE_INFO.IF`가 `ready:true`로 활성화됨.)
- **[정직성] 화면 표시:** 옛 `⚠ Deferred measurement` **경고 배너는 없앴다** — 이제 그런 회로를 지연 계산으로 틀리게 보여주지 않으므로 경고할 일이 아니다. 대신 상황에 맞는 라벨을 붙인다.
  - 궤적으로 계산되는 회로: 회로 툴바에 **`One trajectory` 배지 + Resample**, 상태 수식 아래에 `⚠ One trajectory — measurement collapse is simulated`.
  - **축소 밀도행렬 영역에도 같은 라벨**(`One trajectory — the ensemble is mixed`). 궤적 하나는 순수 상태라 **Purity 가 늘 1.000** 으로 나오는데 실제 앙상블은 혼합 상태다. 라벨이 없으면 "측정했는데도 순수하다"는 잘못된 결론으로 이어진다.
  - 측정은 있지만 그 뒤에 조작이 없는 회로(지연 계산이 **정확**한 경우): `⚠ Pre-measurement state` — 화면의 상태가 붕괴 전임을 밝히되 경고하지 않는다.
- **렌더링:** 캔버스 맨 아래 **고전 레지스터 와이어 1줄(이중선, `c / n` 라벨)** — `clbitCount === 0`이면 아예 그리지 않는다. 회로 패널 높이가 워크스페이스 비율 고정(`--row-right`)이라 행이 늘면 마지막 와이어가 화면 밖으로 밀리므로, `render()`가 **`(큐비트수 + 고전행) × ROW_PITCH + CIRCUIT_CHROME`으로 패널 `min-height`를 잡아준다**(워크스페이스의 72%로 상한). Measure/조건부 게이트에서 고전 와이어까지 **이중선**을 내리고 도착점에 대상 비트 번호 배지를 둔다(측정=회색, 조건=파랑). **한 열에 여러 개가 내려오면 좌우로 벌려** 겹치지 않게 한다(텔레포테이션의 두 측정).
- **직렬화/export:** URL은 `{v:2, n, c:clbitCount, p:[…]}` + params `cb`/`ci`. **`c`가 없는 기존 URL은 `clbitCount = n`으로 열리고**, `clbitCount === n`이면 `c`를 넣지 않아 기존과 동일한 문자열이 나온다. QASM은 `creg c[n];`(0이면 생략) + `measure q[t] -> c[k];` + `if (c==1<<k) …`, Qiskit은 `.c_if(qc.cregs[0], 1<<k)`.
- **범위 밖(이번 미포함):** 복합 조건(c0 AND c1), 측정 후 큐비트 재사용/중간 RESET, 밀도행렬 기반 혼합 상태, 단일 궤적 붕괴 모드.
- **다중 큐비트 게이트 렌더링:** placement는 타겟 큐비트 셀에 저장하고, 관여하는 와이어 사이를 세로 연결선으로 잇는다. 컨트롤은 점(●), SWAP 파트너는 ×로 표시. 관여한 아무 칸이나 클릭하면 placement 전체가 삭제된다.

### 4.3. 회로 편집 방식 / 데이터 모델
- **정규(canonical) placement 셀:** `{ gate, targets:number[], controls:number[], params:{} }`. 모든 게이트가 임의 개수의 컨트롤을 가질 수 있다. CNOT=`{gate:"X",controls:[c]}`, CCX=`{gate:"X",controls:[c0,c1]}`, CZ=`{gate:"Z",controls:[c]}`, CSWAP=`{gate:"SWAP",targets:[a,b],controls:[c]}`. 셀은 홈 행(=`targets[0]`, `grid[col][targets[0]]`)에만 저장하고 나머지 관여 큐비트는 필드로 기록한다.
- **상대위상 게이트(RCCX/RC3X, `kind:"decomposed"`):** 컨트롤 경로를 타지 않고 관여 큐비트를 전부 `targets`에 담는다 — RCCX=`{gate:"RCCX", targets:[a,b,t], controls:[]}`(a,b=컨트롤, t=타깃, **target은 항상 마지막**), RC3X=`{gate:"RC3X", targets:[a,b,c,t], controls:[]}`. 홈은 `targets[0]`(=첫 컨트롤)이라 단일 타깃 게이트와 달리 드롭 행과 다르다 — `placeGate`는 `grid[col][cell.targets[0]]`에 저장한다. `isValidPlacement`는 `TARGET_COUNT`로 타깃 개수(RCCX 3, RC3X 4)를 검증하고 `controls.length===0`을 강제한다. 렌더링은 마지막 target을 ⊕(placed-advanced), 앞쪽을 컨트롤 점으로 그린다.
- **시뮬레이션 엔진(`quantum.js applyPlacement`)은 컨트롤을 일반적으로 처리한다:** n개 컨트롤 = "모든 control 비트가 1인 기저 상태 쌍에만 base 게이트 적용"(`applyUnitary`의 controlMask). 게이트별 컨트롤 특수 분기는 없다. 순수 함수 `circuit.js simulate(qubitCount, grid, steps)`가 그리드→상태벡터를 계산한다.
- **제약:** Measure/Reset/Barrier/CTRL은 컨트롤을 붙일 수 없다. `isValidPlacement`가 거르고, `applyPlacement`는 위반 시 `"<gate> cannot be controlled"` 에러를 던진다.
- **하위 호환:** 구버전 셀(`{gate:"CNOT", controls, partner}`)은 `migrateCell`이 canonical로 변환한다. localStorage 로드·URL 디코드 시 자동 마이그레이션되며, 배포된 v:1 URL은 `decodeCircuit`의 v:1 분기로 계속 열린다(현재 인코딩은 v:2). **RCCX/RC3X는 v:1에서 `gate`명이 보존되므로**(`{g:"RCCX", x:[a,b]}`) `migrateCell`의 `decomposed` 분기가 `targets:[a,b,homeRow]`로 정확히 복원한다 — 예전처럼 CCX로 흡수되지 않는다. v:1 디코드는 홈=`targets[0]`에 저장한다. QASM/Qiskit export는 controls 패턴을 표준명으로 역매핑하되(X+1→cx, Z+1→cz, X+2→ccx, X+n→Qiskit mcx, 미지원 조합은 주석), **RCCX/RC3X는 역매핑보다 먼저 고유 분기로** `rccx`/`rc3x`(Qiskit `qc.rccx`/`qc.rcccx`)로 내보낸다(ccx로 잘못 나가지 않음). CTRL(•) 칼럼 수정자는 export하지 않는다.
- **테스트:** `test/` 디렉터리(`node --test test/*.test.mjs`로 실행 — 이 Node 버전은 디렉터리 인자를 모듈 경로로 오인하므로 glob으로 파일들을 넘긴다). `circuit-refactor.test.mjs`: CNOT/CCX/CZ 동작, 컨트롤 미만족 불변, 마이그레이션 회귀, 구 URL 복원, 제약 에러, export 역매핑을 검증한다. **RCCX/RC3X:** 8/16개 기저 정확 진폭(RCCX |011>→+i|111>, |101>→−1, |111>→−i|011> 등), 유니터리성 U†U=I, RCCX≠CCX, H⊗H⊗H 후 상대위상 3개(π/2·π·3π/2), 구 v:1 URL 복원, `rccx` export를 검증한다. **RYY:** RYY(π/2)|00>=(|00>+i|11>)/√2(Qiskit RYYGate 일치)·|01>=(|01>−i|10>)/√2·유니터리성·`ryy` export. **CSWAP:** control q0=1이면 q1,q2 교환·control=0 불변·프리셋 migrateCell→SWAP+controls·`cswap` export. `probabilities.test.mjs`: `computeVisibleProbabilities`의 영확률 숨김·임계값 경계·숨긴 개수/확률·6큐비트 top-N cap·showAll·observed 예외·index 순서 보존을 검증한다. `sampling.test.mjs`: `sampleCounts`의 합=shots·확률0 미샘플링·shots=1 단일 기저·정규화(합≠100)·H 50/50 근사(정확히 512 아님)·seed 결정론/변동성을 검증한다. `history.test.mjs`: Undo/Redo(배치·제거·Clear undo·큐비트수·제어·redo 무효화·비변경 제외·50 제한·no-op·스냅샷 격리). `bloch.test.mjs`: 축약 밀도행렬 블로흐 벡터([2]의 |00>·|+i>·Bell·곱상태·cos/sin·GHZ·|r|≤1). `chart.test.mjs`: 확률 차트 X라벨 모드(`pickLabelMode`)·sparse 눈금 간격(`niceTickStep`)·위상(`phaseInfo`). `density.test.mjs`: 축소 밀도행렬/순도([4]의 |00>·Bell·곱상태·GHZ·|+i>·0.5≤Purity≤1, `reducedDensityInfo`). `presets.test.mjs`: 각 회로 프리셋 로드 후 상태벡터 검증(Bell·GHZ·W·Phase kickback·Deutsch–Jozsa·QFT). `classical.test.mjs`: 고전 레지스터/지연 측정 — **무측정 회로의 진폭 회귀 고정**(`test/fixtures-baseline.json`의 작업 전 스냅샷과 실/허수부 비교), `resolveDeferred`가 조건 없을 때 원본 그리드를 그대로 반환, 조건→양자 제어 변환, **텔레포테이션 4가지 입력**(|0⟩·|1⟩·|+⟩·T|+⟩) q2 일치·purity 1, **초고밀도 부호화 4메시지 확정 구분**, 측정 큐비트를 제어로만 쓰는 회로 허용, 거부 4종(측정 후 타깃/RESET/미기록 c[k]/범위 밖), `deferredError` 노출, clbitCount·setCondition·setClassicalBit + undo, 직렬화 왕복·기존 URL 호환, QASM/Qiskit(creg·measure 대상·if/c_if·고전 비트 0), **궤적 라우팅**(측정 뒤 조작이 있는 회로를 거부하지 않고 `usesTrajectory=true` 로 계산 — `resolveDeferred` 자체는 여전히 거부한다), **Resample 이 Inspect 꺼짐에도 알린다**, **Inspect 를 끄면 stepIndex 가 끝으로 간다**. `trajectory.test.mjs`: 궤적 실행(붕괴 후 H 가 다시 중첩·되감기 결정론·시드 변동성·진짜 RESET·조건부·텔레포테이션 4결과) + **고정 시드 집계** — 핵심 회로 `h/measure/h/measure` 의 고전 4결과 각 25% 근처, 같은 회로의 큐비트 기저는 50/50 두 개, **Qubits 는 평균이지 샘플링이 아니다**(같은 시드에서 분산 비교), 측정 없는 회로에서 평균 == 이론값 **정확히**, `marginalClassical` == 궤적 집계, 시드 4개에 둔감(4%p 이내). **통계 테스트에 난수를 넣지 않는다** — 난수원을 주입 가능하게 두고 고정 시드를 넣어 정확한 값을 assert 한다(실패 시 회로가 틀렸는지 그냥 운이 나빴는지 구분된다). `controls.test.mjs`: "•" 배치 UI — 게이트 위 드롭의 후보 목록(3큐비트 `[0,2]`→q2 선택 시 `cy q[2],q[1];`, 2큐비트는 후보 1개, 0개면 거부), **`controlOptions`는 회로·undo 스택 불변**(Esc 취소의 근거), 고를 수 없는 큐비트 거부, **다중 선택**(CCX·오름차순 정규화·undo 한 단계·중복/비후보/빈 선택 거부), **두 경로 결과 셀/직렬화 동일**, 누적, Measure/Reset/Barrier·순수 CTRL 거부, CZ 두 점의 후보·결과 동일, 선택한 제어의 시뮬레이션 반영, 최근접 규칙 회귀, 세 동작의 개별 Undo, `setParams`(파라미터만 교체·상태 반영·Undo), `expandGate`(분해 교체 후 상태벡터가 **상대위상까지 완전히 동일**·Undo 1회 복원·분해 없음/열 부족 거부). `gatematrix.test.mjs`: H·CZ·CNOT·RX(π/2) 정확 행렬, 지원 게이트 전반의 **유니터리성 U†U=I**, 컨트롤 순서 교환(CZ·CCX 동일 / RCCX 상이), 8×8 초과 `tooLarge`, 기저 라벨·`localOrder`, 비유니터리 거부, `formatComplex`/`symbolicComplex`, **분해 데이터가 엔진 동작과 일치**(추출 회귀 고정).
- 회로는 큐비트(행) × 시간 칼럼(열)의 그리드다. 최대 열 개수는 12개.
- 배치: 팔레트에서 게이트를 그리드 셀로 드래그 앤 드롭.
- 삭제: 배치된 게이트 칩을 클릭하면 즉시 제거된다 ("마지막 삭제" 대신 임의 위치 직접 삭제). 별도로 "전체 삭제" 버튼을 제공한다.
- 큐비트를 추가/삭제하면 기존 배치는 유지되며(삭제된 큐비트의 게이트만 함께 사라짐), 즉시 결과 상태로 스냅한다.
- **Undo/Redo(히스토리):** 컨트롤러 내부에 `undoStack`/`redoStack`을 둔다. 회로를 바꾸는 모든 뮤테이션(placeGate/removeGate/addControl/addControlToGate/setParams/expandGate/removeControl/clear/setQubitCount)이 **변경 직전** `pushUndo()`로 전체 스냅샷(`{qubitCount, grid}` 딥클론)을 저장한다(diff 아님). 검증에 실패해 early-return하는 경로에서는 push하지 않아 빈 히스토리가 쌓이지 않는다. 최대 `MAX_HISTORY=50`단계, 초과 시 오래된 것부터 버린다. **재생 위치 이동(reset/step/play)·큐비트 탭 선택(selectQubit)은 히스토리에 쌓지 않는다.** `undo()`/`redo()`는 현재 상태를 반대 스택에 넣고 스냅샷을 복원한 뒤 `notify()`한다(뷰/재생 상태는 clamp만). `Clear all`도 되돌릴 수 있어야 하는 것이 주 목적. snapshot에 `canUndo`/`canRedo`를 노출해 버튼 활성/비활성을 제어한다.
- **Undo/Redo UI:** Circuit 툴바(큐비트 스테퍼 오른쪽)에 ↰/↱ 아이콘 버튼. 단축키 `Ctrl+Z`(실행취소)·`Ctrl+Shift+Z`(다시실행), Mac은 `Cmd`. `e.target`이 INPUT/TEXTAREA/SELECT/contentEditable이면 가로채지 않는다(텍스트 편집 우선). 스택이 비면 버튼 비활성(`.icon-btn:disabled` opacity 0.35). 테스트: `history.test.mjs`(배치·제거·clear undo·큐비트수·제어 add/remove·redo 무효화·비변경 제외·50 제한·빈 스택 no-op·스냅샷 오염 방지, 11개).

### 4.4. 재생/애니메이션 (원본에서 분할)
- 재생 단위는 "칼럼"이다. 한 스텝 = 해당 칼럼에 있는 모든 큐비트의 게이트를 동시 적용. 재생은 마지막 칼럼까지 진행 후 정지(반복 없음).

### 4.5. 측정/Reset에 대한 결정론적 근사
- 실제 무작위 붕괴(collapse)는 구현하지 않는다. Measure는 "그 시점까지의 확률 분포 확정"만 의미하며 상태를 바꾸지 않는다.
- Reset(|0⟩)을 도입할 때는 항상 |0⟩ 분기로 결정론적 사영(projection) 후 재정규화한다. 얽히지 않은 큐비트에는 정확하고, 얽힌 큐비트에는 근사임을 인지한다.

### 4.8. 지속성
- 큐비트 수와 회로 그리드 배치는 `localStorage`에 저장하여 새로고침 후에도 유지한다. 재생 진행 상태(스텝 위치)는 저장하지 않고 항상 완성된 최종 상태로 복원한다.

### 4.10. 회로 공유 / 내보내기 (`js/export.js`)
- **URL 공유:** 회로(큐비트 수 + 배치)를 JSON→base64url로 인코딩해 `#c=...` 해시로 표현한다. 공유 버튼(링크 아이콘)이 현재 회로의 공유 URL을 클립보드에 복사한다. 페이지 로드 시 해시가 있으면 localStorage보다 우선 적용하고, 이후 편집이 오래된 해시로 되돌아가지 않도록 즉시 해시를 제거한다.
- **내보내기:** 내보내기 버튼(코드 아이콘) → 메뉴에서 "Copy OpenQASM 2.0" / "Copy Qiskit (Python)" 선택 시 해당 코드가 클립보드에 복사된다. Control(•) 칼럼 수정자는 표준 표현이 없어 내보내지 않고 주석으로 명시한다. RC3X는 Qiskit에서 `rcccx` 메서드로 매핑.
- 공유/내보내기 버튼은 Circuit 패널 툴바에 두고, 복사 완료는 하단 토스트로 알린다.

### 4.10.1. 회로 프리셋 / Example Circuits (`js/presets.js`)
- Circuit 툴바 "Clear all" 옆 **"Examples ▾" 드롭다운**(팔레트가 아니라 회로 전체 교체이므로 툴바에 둔다). Quirk 스타일로 **카테고리 헤더(Basics/Algorithms/Protocols) 아래 이름만 나열**, 항목 hover 시 한 줄 설명을 `showTooltip`으로 표시. `PRESET_CATEGORIES` + 각 프리셋의 `category` 필드로 그룹(UI 메타데이터일 뿐, 회로 저장 구조와 무관).
- **저장 형식([2]):** 프리셋은 별도 자료구조 없이 **공유 URL과 동일한 직렬화 문자열**(`circuit`)로만 갖는다. `{ name, description, category, qubits, circuit }`. 로드 = `decodeCircuit(circuit)` → `circuit.loadCircuit(qubitCount, grid)`. 큐비트 수는 문자열에 담겨 자동 설정된다.
- **`loadCircuit`(circuit.js):** 현재 회로를 통째 교체하되 **`pushUndo`로 반드시 Undo 스택에 기록**([1]) → 실수로 눌러도 Ctrl+Z로 복구. 로드 시 "Loaded … — Undo to revert" 토스트. 별도 확인 모달 없음.
- **목록:** Basics(Bell Φ+·GHZ·**W state**·Phase kickback), Algorithms(Deutsch–Jozsa balanced/constant·Bernstein–Vazirani s=101·Grover 2q·QFT), Protocols(Quantum teleportation·Superdense coding). 각 `circuit`은 canonical 그리드→`encodeCircuit`로 만들고 simulate로 기대 상태를 대조 검증했다.
  - W state: X + controlled-RY 캐스케이드(`X q0; CRY(2·acos(1/√3)) q1←q0; CNOT q1→q0; CRY(π/2) q2←q1; CNOT q2→q1`). QFT는 H·controlled-P·SWAP + DFT 위상 검증. Grover 2q는 CZ 오라클+diffuser 1회 → |11⟩ 확정. BV는 s=101을 1쿼리로 복원(입력 |101⟩ 확정).
  - **Teleportation 주의:** 이 앱의 Measure는 **no-op(붕괴 없음)**이라 측정 기반 텔레포테이션을 충실히 시뮬할 수 없다. 그래서 **coherent(deferred-measurement) 버전**(CX/CZ 보정, Measure 미사용)으로 넣었다 — q0의 상태가 q2로 정확히 이동함을 축소밀도행렬로 검증. 측정 기반/CHSH 등은 mid-circuit measurement 기능이 생긴 뒤로 미룸(README Roadmap).
- **테스트([4], 필수):** `test/presets.test.mjs`가 각 프리셋을 디코드→simulate 해 기대 상태벡터와 대조한다(Bell/GHZ/W/Phase kickback 정확 진폭, DJ balanced→입력 |11⟩·constant→|00⟩, BV→|101⟩, Grover→|11⟩, Superdense→|11⟩, Teleport→q2 bloch=(√2/2,√2/2,0)·purity 1, QFT|000⟩ 균등, 전부 정규화·큐비트수·category 일치). 인코딩이 깨지면 이 테스트가 잡는다.

### 4.12. 축소 밀도행렬 뷰 (Probabilities 패널 오른쪽)
- Probabilities 패널은 좌우 분할이다: **왼쪽 = 확률 SVG 차트(4.15), 오른쪽 = 선택 큐비트의 2×2 축소 밀도행렬 뷰**(`#dm-view`). 예전의 전체 2ⁿ×2ⁿ Density Matrix Cityscape(3D)와 그 chart↔cityscape 토글은 제거했다 — 노이즈 없는 시뮬레이터의 상태는 항상 순수라 전체 밀도행렬은 상태벡터와 정보량이 같고(5큐비트면 1024성분) 표시가 무의미하기 때문. (`js/cityscape.js`는 미사용.)
- **계산은 `js/density.js`로 분리**([5], DM 뷰와 Bloch sphere가 공유). `reducedDensityMatrix(state, k)`가 전체 행렬을 만들지 않고 O(2ⁿ)로 2×2를 누적: `rho00/rho11 = Σ|ψ|²`, `rho01 = Σ_{bit k=0} ψ[i]·conj(ψ[i|1<<k])`, `rho10 = conj(rho01)`. `purityFromRho`(=Tr(ρ²)=rho00²+rho11²+2|rho01|², 0.5~1), `blochVectorFromRho`, `reducedDensityInfo(state,q)`→`{rho, bloch, r, purity, mixedness}`(mixedness=2(1−purity)=1−|r|²).
- **뷰(`renderDensityMatrix`):** 상단 큐비트 탭(q[0]…, 선택은 `circuit.selectQubit`으로 Bloch sphere와 전역 공유). 2×2 행렬은 대각=실수(`0.500`), 비대각=복소수(`0.000 − 0.500i`)로 표기하고, **셀 배경을 |값|/max로 옅게 칠해**(rgba primary) 대각/비대각 구조가 보이게 한다. 아래에 Purity, Mixedness 0~100% 바(부동소수점 오차 클램프), Bloch r=(rx,ry,rz)·|r|, 그리고 캡션(Purity≥0.999 "Pure — not entangled with other qubits" / ≤0.501 "Maximally mixed — maximally entangled" / 그 사이 "Partially mixed"). `snapshot.state`(원본 상태벡터)로 매 렌더 계산한다.
- 테스트 `density.test.mjs`: |00>·Bell(diag 0.5,0.5)·곱상태(Purity 1)·GHZ(0.5)·|+i>(rho01=−0.5i, r=(0,1,0))·모든 경우 0.5≤Purity≤1.

### 4.13. Probabilities 표시 필터 ("Hide 0%")
- **`quantum.js`의 순수 함수 `computeVisibleProbabilities(probabilities, { hideZero, threshold, qubitCount, topN, showAll, observed })`**가 표시할 상태를 계산한다(DOM 무관, `test/probabilities.test.mjs`로 검증). 반환: `{ visible, hiddenZeroCount, hiddenZeroProb, cappedCount, capActive, totalCount }`.
- **Hide 0% 토글**(Probabilities 패널 툴바 오른쪽 체크박스, 기본 켜짐): 확률이 임계값(`threshold=1e-9`, `probability` 필드는 퍼센트라 `p/100 ≤ threshold`로 비교) 이하인 기저 상태를 목록에서 제외하고, 푸터(`#prob-footer`)에 "N states hidden (X%)"로 숨긴 개수·확률 합을 표시한다.
- **큐비트 6개 이상**이면 임계값과 무관하게 확률 상위 `PROB_TOP_N=32`개만 표시하고, 나머지는 "Show all N states" 버튼으로 펼친다(펼친 뒤엔 "Show top 32"로 접기). 정렬은 확률 내림차순으로 상위 N을 고르되 렌더는 원래 index 순서를 유지한다.
- **관측 상태(observed)**: 샘플링에서 관측된 기저(count>0)는 어떤 필터(영확률·top-N)로도 숨기지 않는다. `renderProbabilities`가 `sampleResult`에서 관측 집합을 만들어 `computeVisibleProbabilities`에 넘긴다(4.14 참고).
- Density Matrix(cityscape) 뷰에서는 확률 필터가 무의미하므로 토글·푸터·샘플링 컨트롤을 숨긴다. 토글/버튼 조작 시 `renderProbabilities(circuit.getSnapshot())`로 즉시 다시 그린다.

### 4.14. 측정 샘플링 (Run / shots)
- **의미:** **궤적이 필요 없는 회로에서만** 이 경로를 쓴다 — 회로 끝(현재 표시 중인 최종 상태벡터) 샘플링이다. 중간 측정이 있는 회로는 버튼이 `Resample statistics` 가 되고 3.m 의 궤적 집계가 값을 만든다.
- **순수 함수 `quantum.js`의 `sampleCounts(probabilities, shots, rng = Math.random)`**: `probability`(퍼센트)를 |amp|²로 보고 합으로 나눠 **정규화**한 뒤 누적분포(CDF, 마지막=1로 float 보정)를 만들고, 균등난수로 **이진 탐색**해 shots번 뽑는다. 반환 `counts[i]`(probabilities[i]에 정렬). 확률 0 구간은 CDF가 앞과 같아 절대 선택되지 않는다. `rng` 주입으로 결정론적 테스트(`test/sampling.test.mjs`).
- **UI(Probabilities 툴바):** `shots` 입력(기본 1024, 1~100000 clamp), **Run**·**Reset** 버튼. Run은 현재 분포에서 샘플링해 이론 막대(연한 파랑, 전체폭) 위에 관측 막대(진한 파랑, 좁게 중앙)를 겹쳐 그리고 각 막대에 관측 횟수("261/1024")를 표시한다. Reset은 `sampleResult=null`로 이론값만 보이게 한다(관측이 있을 때만 노출).
- **비동기:** `shots > SAMPLE_CHUNK(10000)`이면 청크로 나눠 `setTimeout(0)`으로 이벤트 루프에 양보하며 누적(UI 프리즈 방지). Run 중엔 버튼 비활성.
- **무효화:** `sampleResult`에 분포 서명(`probSignature` = 큐비트수 + 반올림 확률들)을 함께 저장하고, 회로 편집/스텝/큐비트수 변경으로 서명이 바뀌면 `render()`에서 샘플을 폐기한다(큐비트 탭 선택·Hide 토글 등 분포 불변 동작에서는 유지). 샘플링 중 회로가 바뀌면 결과를 반영하지 않는다(서명 재확인).

### 4.11. Bloch 축약상태 / Q-sphere 전환 (원본에서 분할)
- **축약 밀도행렬 블로흐 벡터(`js/density.js`, DM 뷰와 공유):** 선택 큐비트 k의 블로흐 벡터는 축약 밀도행렬(부분대각합)에서 구한다 — `reducedDensityMatrix(state, q)`가 전체 2ⁿ×2ⁿ를 만들지 않고 O(2ⁿ)로 2×2 ρ를 누적하고, `blochVectorFromRho`가 `x=2·Re(ρ01), y=−2·Im(ρ01), z=r00−r11`을 낸다. 다체계에서 |r|<1이면 축약상태가 혼합이다. `test/bloch.test.mjs`가 |00>·|+i>(부호규약)·Bell(|r|=0)·곱상태(|r|=1)·cos t|00>+sin t|11>(|r|=|cos 2t|)·GHZ(|r|=0)·`|r|≤1`을 검증한다.
- **정보 바(`#bloch-info`, Bloch 뷰):** `Purity = (1+|r|²)/2`와 `Local mixedness = 1−|r|`(0~100% 바)를 표시한다. 라벨은 **"Mixedness"**(얽힘 아님) — 다체계에서 |r|<1의 원인이 얽힘만은 아니므로 정확한 용어를 쓴다. `updateBlochInfo`가 매 렌더 갱신.