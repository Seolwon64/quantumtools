# 백로그 — 남은 과제와 알려진 규칙 위반

대화와 단계 보고에만 있던 과제를 모은다. 세션이 바뀌어도 잃지 않게 하려는 것이다.

- **명세(`design-spec.md`·`quantum-spec.md`)의 규칙은 여기 있는 위반에 맞춰 고치지 않는다.**
  규칙이 맞고 코드가 어긴 것은 "규칙 위반" 으로 여기서 추적한다. 고치지 않기로 **정한** 것은
  여기가 아니라 design-spec 의 "알려진 한계" 절에 있다.
- 출처 단계는 기록이 남아 있는 것만 적는다. 근거는 줄 번호가 아니라 심볼이다.
- 끝낸 항목은 지운다(이력은 git 에 있다).

## 높음

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| **QASM·Qiskit 내보내기가 비트 하나의 조건을 레지스터 전체 비교로 쓴다** — 내보낸 텔레포테이션이 Qiskit 에서 틀리고, Qiskit 코드는 Qiskit 2.x 에서 실행되지 않는다 | 끝 RESET 수정의 Aer 대조 (2026-10-14) | `export.js` `toQASM`(`creg c[n];` 하나 + `if (c==2^k)`), `toQiskit`(`.c_if(qc.cregs[0], 2^k)`), `qasm.js` `parseQASM`(creg 를 하나만 받고, `conditionBit` 가 `c==2^k` 를 비트 k 로 읽는다) | **QASM:** OpenQASM 2.0 의 `if (c==2)` 는 "c 가 정확히 0b010" 이고, 앱은 "c[1] 이 1" 로 읽는다(내보내기 머리말 경고가 이미 그렇게 말한다). 내보낸 텔레포테이션을 Qiskit 이 그대로 읽어 Aer(qiskit 2.5.2·aer 0.17.2, density_matrix, 100,000 shots)로 돌리면 q2 = (+0.358, +0.707, 0) 이다 — 원래 상태는 (+0.707, +0.707, 0). c=011 갈래에서 두 조건이 모두 거짓이라 보정이 빠지고, 그 1/4 이 (−0.707, +0.707, 0) 이라 평균 x 가 0.354 가 된다. **Qiskit 코드:** 같은 프리셋의 내보낸 코드를 qiskit 2.5.2 로 실행하면 `qc.x(2).c_if(qc.cregs[0], 2)` 에서 `AttributeError: 'InstructionSet' object has no attribute 'c_if'` 로 멈춘다(Qiskit 2.0 이 `c_if` 를 지웠다). 프리셋 11개 중 조건이 없는 10개의 코드는 실행된다. `classical.test.mjs` 「Qiskit: c_if와 measure 대상 비트」 가 지금의 `c_if` 문자열을 고정하고 있다. **해결 방향(Aer 로 확인):** QASM 은 고전 비트마다 1비트 레지스터(`creg c0[1]; … measure q[1] -> c1[0]; if (c1==1) x q[2];`), Qiskit 코드는 `with qc.if_test((qc.clbits[k], 1)):` — 둘 다 q2 = (+0.707, +0.707, 0). **함께 바뀌는 것:** `parseQASM` 이 creg 여럿을 받아 이름을 비트 인덱스로 풀어야 한다(지금은 "multiple qreg/creg" 로 거부). `qasm.test.mjs` 의 「모든 프리셋의 QASM 텍스트가 Apply 왕복 뒤 한 글자도 바뀌지 않는다」·「[3] creg 선언과 measure 문의 인덱스 쌍이 정확하다」(`creg c[n];` 을 찾는다)·「[3] if 줄이 왕복 전후로 문자열까지 같다」·「에러에 줄 번호와 구체적 사유가 함께 붙는다」 의 "복수 creg" 행, if 경고 테스트 둘(「if 경고는 조건이 있고 고전 비트가 2개 이상일 때만 뜬다」·「if 경고 문구가 무엇이 어떻게 다른지 말한다」 — 경고가 필요 없어진다). 셀 모델(`params.cif`)은 그대로라 공유 링크·저장 회로는 영향이 없다. **정할 것:** 가져오기가 예전 형태 `creg c[n]; if (c==2^k)` 를 계속 "비트 k" 로 읽을지(앱이 예전에 내보낸 텍스트와 호환), OpenQASM 뜻대로 읽을지 |
| 편집 후 Apply 가 코드로 표현되지 않는 게이트를 경고 없이 지운다 | 6단계 | `codepanel.js` Apply 경로, `qasm.js` 매핑 표 | 사용자는 지워진 줄 모른다. quantum-spec "QASM / Qiskit 왕복 계약" 의 "조용히 넘어가지 않는다" 와 같은 성격 |
| 파라미터 팝오버가 건드리지 않은 φ·λ 를 바꾼다 | 8단계 | `popover.js` `openParamEditor` | θ 만 바꿔 Apply → φ 1.235 → 1.239, λ 2.346 → 2.339(U 게이트, 8단계 실측). 원인 미확인 |

## 중간

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| 회로 키보드 탐색이 없다 — 게이트 조작 전체가 마우스 전용이고, 배치된 칩에 역할·이름이 없다 | 8단계 | `grid.js` `buildCircuitGrid`(칩·제어점 `tabindex="-1"`, role 없음), `gatemenu.js` `openMenuForCell`(포인터 좌표로 연다) | 게이트 정보도 마우스로만 열린다. 그리드를 통째로 다시 그려 생기는 스크린리더 재읽기(design-spec "알려진 한계")의 근본 해결도 여기서 |
| 프리셋을 고르면 포커스가 body 로 떨어진다 | 8단계 | `main.js` 프리셋 메뉴(`.preset-item`) | design-spec "원칙 — 포커스와 Esc" 의 "숨는 요소의 포커스는 옮긴다" 위반 |
| 파라미터 팝오버가 열릴 때 포커스를 가져가지 않는다 | 8단계 | `popover.js` `openParamEditor` | 같은 원칙의 "사용자가 열면 그 안의 첫 자리로" 위반 |
| 얽히지 않은 리셋에서 앙상블이 순수한데 DM 캡션이 "ensemble is mixed" 라고 말한다 | 끝 RESET 수정 (2026-10-14) | `main.js` DM 패널의 `dm-traj-note` 캡션(`snapshot.usesTrajectory` 만 본다), `trajectory.js` `needsTrajectorySampling`(RESET 이 있으면 궤적) | RESET 이 있으면 무조건 궤적이라, 리셋 대상이 곱 상태여서 모든 궤적이 같은 순수 상태로 끝나는 회로에도 캡션이 붙는다(예: `H q0, H q1 · RESET q0`). 안: 궤적별 축소 ρ 의 평균으로 선택 큐비트의 앙상블 순도를 계산해, 1 에 가까우면 캡션을 조건부로 바꾼다. `aggregateTrajectories` 가 이미 궤적을 순회하므로 그 순회에서 ρ 를 함께 모을 수 있다 |
| 사유가 뜬 회로에서도 확률 차트·DM 패널은 자리표시 상태 `\|0…0⟩` 을 결과처럼 그린다 | 끝 RESET 수정 (2026-10-14) 브라우저 확인 | `circuit.js` `stateAt`(error 일 때 `initialState` 를 돌려준다), `probview.js` `renderProbabilities`·`main.js` DM 렌더(둘 다 `deferredError` 를 보지 않는다), `main.js` `renderStateFormula` 힌트 | 상태 패널만 사유를 보이고 확률 막대는 `\|00⟩` 100%, DM 은 "Pure — not entangled" 다(측정된 큐비트 위 • 회로, 1536×740 실측). `circuit.js` `snapshot` 주석의 "placeholder 상태가 결과로 제시되는 일은 없다" 와 어긋난다. 지연 변환 거부(아래 • 오거부)에서 원래 있던 표시이고, 엔진 거부가 백지 대신 사유로 바뀌며 같은 표시를 쓰게 됐다. 힌트 "Step back or edit the circuit to continue." 도 로드 때 거부에는 맞지 않는다 — 스텝 버튼이 모두 막혀 있다 |
| 툴팁의 진폭이 막대 값과 다른 곳에서 온다 — 궤적 모드에서 "Estimated 49%" 옆에 "Amplitude 1.000" | 끝 RESET 수정 (2026-10-14) | `probmodel.js` `probDisplay`(궤적이면 `probability` 만 `aggregate.qubitProbs` 로 바꾸고 `re`·`im` 은 표시 궤적의 `snapshot.probabilities` 것을 남긴다), `barTooltipHTML` | 막대는 N회 평균인데 진폭·위상은 궤적 하나의 것이라 \|진폭\|² 이 막대와 맞지 않는다. 텔레포테이션처럼 중간 측정이 있는 회로에 원래 있던 문제인데, **RESET 회로도 궤적 모드로 가면서 범위가 넓어졌다.** 고전 비트 막대처럼 진폭 행을 빼거나, "이 궤적의 진폭" 이라고 밝히는 안 |
| **규칙 위반:** 네이티브 `disabled` | 9단계 | `main.js` render(큐비트±·고전비트±·Clear·Run·Undo/Redo), `popover.js`(Apply), `probview.js`(Run) | design-spec "인터랙티브 상태" 의 금지 규칙. 규칙의 이유 그대로 — 한계에 닿은 큐비트 −/+ 가 "왜 안 되는지" 를 툴팁으로 말하지 못한다. 재생 버튼만 `setPlaybackDisabled` 로 지킨다 |

## 낮음

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| 표시 포매터가 세 벌이다 | 8단계 | `probmodel.js` `fmt2`(2자리 — 상태벡터·밀도행렬), `gatematrix.js` `formatComplex`(3자리 — 게이트 행렬), `probmodel.js` `barTooltipHTML`(3자리 — 확률 막대 툴팁) | 행렬 자릿수를 바꾸면 8×8 자연 폭이 바뀌어 `--col-1-max` 가 움직인다(열 배분 전체) |
| 확률 Hide 0% 의 기준이 1e-9 다 | 기록 없음 | `quantum.js` `computeVisibleProbabilities` 의 `threshold` | 상태벡터 Hide 0.00 은 표시 자릿수(계수) 기준이다 — 두 기준이 왜 다른지 문서화돼 있지 않다 |
| 체크박스 토글 링이 `:focus-within` 이다 | 6단계 | `style.css` 중앙 focus-visible 블록의 `.prob-hide-toggle`·`.state-hide-toggle` | design-spec 원칙은 `감싸개:has(요소:focus-visible)`. 마우스 클릭에도 링이 뜰 수 있다 |
| 게이트 메뉴·팝오버가 document 전역 Esc 로 닫힌다 | 8단계 | `gatemenu.js` `initGateMenu`, `popover.js` `initPopover` 의 document keydown | design-spec 원칙은 "일시적 UI 는 포커스가 안에 있을 때만". 게이트 메뉴는 열면 포커스를 안으로 가져가 지금은 차이가 작다 |
| Q-sphere 6큐비트 라벨이 77% 겹친다 | 2부 | `scene.js` 라벨 스프라이트 | 지름으로는 안 풀린다(design-spec "알려진 한계"). 라벨 배치를 바꾸는 일 |
| 행렬 가로 스크롤바가 행렬 아래에 있다 | 8단계 | `gatemenu.js` `.mx-scroll`, `style.css` `.gate-info` | 정보가 세로로 스크롤되는 화면에서는 내려야 보인다(Shift+휠·Tab 후 화살표로는 바로 민다) |
| 헤더 높이를 가장 큰 자식이 정한다 | 7단계 | `style.css` 헤더 규칙 | 햄버거(36px)를 헤더 버튼(33px)으로 바꾸자 헤더가 60 → 57px 로 바뀌어 행 높이가 함께 움직였다. 헤더 높이를 토큰으로 고정하는 것을 검토 |
| 3열 최대를 설명 문단 줄 길이가 정한다 | 2부 | `style.css` 열 토큰 주석(3열 최대 = 영문 80자) | 80ch 는 열 폭이 아니라 문단의 max-width 에 걸 일 |
| **규칙 위반:** 레이아웃 속성 전환 | 9단계 | `style.css` `.prob-bar-fill-obs`·`.prob-bar-fill-v`(height), `.dm-mixed-fill`·`.bloch-mixed-fill`(width) | design-spec "인터랙티브 상태" — 레이아웃을 매 프레임 다시 계산하지 않는 속성만 |
| **규칙 위반:** 기본 이징·토큰 밖 전환 값 | 9단계 | `style.css` `.dm-mixed-fill`·`.bloch-mixed-fill`·`.mode-toggle-track`(`ease`), 확률 막대(`cubic-bezier`·`0.35s`) | 시간과 이징은 `--dur`·`--ease` 로 |
| 폰트 서브셋에 더는 안 쓰는 글리프 5개가 남아 있다 | 9단계 | `style.css` `@font-face`(QT Math) `unicode-range` 의 U+25BE ▾ · U+27F2 ⟲ · U+26A0 ⚠ · U+23EE ⏮ · U+23F8 ⏸, `fonts/*-subset.woff2` | 아이콘을 Lucide 로 바꾸며 UI 에서 사라졌다. 빼려면 서브셋을 다시 만든다 |
| 측정된 큐비트 위의 혼자 있는 • 를 지연 변환이 틀리게 거부한다 — 같은 뿌리로 BARRIER 와 같은 열의 • 는 궤적 경로에서 백지를 낸다 | 9단계, 끝 RESET 수정 (2026-10-14) | `classical.js` `resolveDeferred` 분기 1(• 셀도 `targets` 를 가져 "modified by •" 로 걸린다), `trajectory.js` `runTrajectory`(열의 • 를 BARRIER 에도 `applyPlacement` 제어로 넘긴다), `circuit.js` `stateAt`(궤적 분기는 예외를 감싸지 않는다) | 원래 과제 "지연 변환의 거부 경로가 아직 화면에 닿는지 확인" 의 답이다. 무작위 회로 200,000개 퍼징(2026-10-14)에서 "측정 뒤 RESET" 거부는 **0개**(수정 전 1,340), 화면에 닿는 거부는 이 • 오거부 446개만 남았다. 팔레트로는 못 만든다(빈 칸의 • 는 `addControl` 이 같은 열 게이트에 붙인다) — 공유 URL·저장 회로로만 들어온다. 거부 분기는 `simulate()` 의 "조용히 틀리지 않는다" 계약을 지키는 방어로 남겼다(주석). 같은 뿌리의 증상: MEASURE·BARRIER 와 같은 열의 • 를 엔진이 "cannot be controlled" 로 거부한다. 빠른 경로에서는 이제 사유로 보이지만(5,356개), **궤적 경로의 BARRIER + • 는 아직 백지다**(3,123개 — 수정 전에도 같은 회로가 백지였다, 회귀 아님). 제어할 게이트가 없는 열의 • 를 무시하는 것이 근본 수정이다 |
| 끝단 측정과 얽히지 않은 리셋이 함께 있으면 Classical 막대가 정확값에서 N회 계수로 바뀐다 | 끝 RESET 수정 (2026-10-14) | `trajectory.js` `needsTrajectorySampling`(RESET 이 있으면 궤적), `probmodel.js` `probDisplay`(궤적이면 `aggregate.classical`, 아니면 `marginalClassical`) | 예: `H q1 · MEASURE q1 · RESET q0` — 예전엔 이론 주변화로 정확히 50/50, 지금은 1024회 계수(σ ≈ 1.6%p). 큐비트 막대는 정확값 그대로다(모든 궤적이 같다). 측정 결과가 확률적인 한 계수의 오차는 줄지 않으므로, 고치려면 얽힘을 보는 판정이 필요하다 — quantum-spec §5 가 두지 않기로 한 그 판정이다 |
| 아무 게이트도 거치지 않은 큐비트의 RESET 은 항등이다 — 정적으로 판정해 궤적 판정에서 뺄 수 있다 | 끝 RESET 수정 (2026-10-14) | `trajectory.js` `needsTrajectorySampling`(`hasReset`), `quantum.js` `applyPlacement`(RESET 거부) | `reset q;` 로 시작하는 QASM 회로가 지금 1024회 평균으로 보이고 "One trajectory" 가 붙는다. 그 열까지 대상 큐비트에 닿는 셀(타깃·제어·•)이 없으면 큐비트는 `\|0⟩` 이라 리셋이 항등이다 — 시뮬레이션이 필요 없어 상태 의존 판정의 비용이 없다. **주의: 엔진이 RESET 을 거부하므로, 빼려면 빠른 경로가 그 RESET 을 no-op 으로 건너뛰어야 한다**(판정만 바꾸면 `stateAt` 이 엔진의 거부 사유를 띄운다). 이번에는 구현하지 않았다 |

## 디자인 재작성 과제

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| 상태 표시와 상호작용이 모두 액센트다 | 8·9단계 | `style.css` 액센트 토큰 주석, `.selected`(outline), `.info-target`(후광), 재생 진행 점선, focus-visible 링 | design-spec "색상 — 3층 구조" 의 "액센트는 누를 수 있는 것 전용" 과 충돌한다. 규칙은 의도로 남겼다 — 재작성에서 상태 표시용 색을 따로 둘지 정한다 |

## 하네스

앱이 아니라 앱을 지키는 장치(훅·`scripts/`·스킬 스크립트)의 구멍이다. 무게의 기준은 위 절들과
같고, 한 절에 모았으므로 열로 적는다. 수치는 2026-10-14 실측이다.

| 과제 | 무게 | 출처 | 근거 | 메모 |
|---|---|---|---|---|
| **`js/` 의 import 대상이 실제로 있는지 검사하는 장치가 없다** — 파일을 옮기고 경로를 안 고치면 앱 전체가 죽는데 문법 검사와 테스트는 통과할 수 있다 | 중간 | 커밋 683d624 | `run-tests.mjs` `checkSyntax`(`node --check` 는 파싱만 하고 지정자를 풀지 않는다)·`runTests`(테스트가 임포트한 모듈만 링크된다), `index.html` 의 모듈 진입점·importmap | 상대 import 51개 중 36개 — `main`·`grid`·`gatemenu`·`popover`·`playback`·`probview`·`codepanel`·`scene` 8개 모듈의 것 — 와 `index.html` → `js/main.js` 는 어떤 검사도 풀어 보지 않는다. 지금 깨진 것은 0개. 683d624 는 `js/` import 31개 중 17개와 진입점이 깨졌고 754f8d4 에서 되돌려졌다(커밋 시각 기준 7일 뒤). **다만 그 커밋은 테스트의 import 32개도 전부 깨져 `node --test` 를 돌렸다면 잡혔다**(정적 확인, 실행은 안 했다). 그래서 구멍은 둘이다 — ① 테스트가 링크하지 않는 8개 모듈 안에서만 일어나는 이동(`main.js` 분해가 그 작업이다) ② 사람 커밋에는 아무것도 돌지 않는다(Stop 훅은 에이전트 턴 끝에만 돌고 git 훅·CI 는 없다). ①은 `ui-invariants.test.mjs` 처럼 소스를 텍스트로 읽는 테스트면 훅을 고치지 않고 막힌다. 맨 지정자(`three`·`three/addons/`)는 디스크가 아니라 importmap 키와 대조한다. 파일 존재만 보면 "있는 파일에 없는 export 를 가져오는" 링크 오류는 남는다 |
| 서브에이전트 체커 `check-agents.mjs` 를 `scripts/` 로 승격 — 지금은 리포에도 디스크에도 없다 | 낮음 | 세션 기록(8/22 초판, 9/1 재작성) | `.claude/agents/*.md` 프론트매터(8필드 순서·금지 필드·에이전트별 `tools`), `run-tests.mjs` `CHECK_DIRS` | 한 번도 커밋된 적이 없다. 있던 자리는 예전 경로(`OneDrive\Desktop`) 세션의 스크래치패드였고 그 디렉터리는 사라졌다. 남은 사본은 세션 기록 안의 Write 호출뿐이다 — `~/.claude/projects/C--Users-1-OneDrive-Desktop-BLOCH-SPHERE/` 의 `f8846f5b….jsonl`(2026-09-01, 검사 A~J. 같은 호출이 `4cc613ed….jsonl` 에도 있다). 이미 한 번 잃고 다시 쓴 판이다(파일 머리말). **무게는 낮지만 기한이 있다** — 두 기록의 마지막 수정이 9/5·9/6 이고 사용자 설정 `cleanupPeriodDays` 가 90 이라 12월 초에 정리 대상이 된다. 되살려 지금의 네 파일에 돌리면 A~J 전부 통과하므로 규칙을 고치지 않고 옮길 수 있다. 옮기는 것만으로는 Stop 훅이 문법만 본다(`scripts/` 의 다른 두 체커와 같다) — 돌게 하는 것은 따로 정한다 |
| `verify-gate-registration.mjs` 가 `PALETTE_GLYPHS`·`QISKIT_NAME` 을 검사하지 않는다 | 낮음 | `adding-quantum-gates` `SKILL.md` "알려진 한계" | 스크립트의 검사 A~H(두 표를 읽지 않는다), `main.js` `makeGateChip`, `export.js` `toQiskit` | 빠지면: `PALETTE_GLYPHS` 는 `info.label` 글자로 물러난다(외관뿐). `QISKIT_NAME` 은 QASM 이름을 메서드명으로 그대로 내보낸다 — 이름이 다른 게이트라면 Qiskit 에 없는 호출이 경고 없이 나간다. **"빠졌는지"는 스크립트가 판정할 수 없다** — 글리프가 필요한지는 디자인 판단이고 Qiskit 이름이 다른지는 리포 밖 지식이다(스킬의 "이름은 추측하지 않는다" 와 같은 성격). 볼 수 있는 것은 반대 방향 — 표의 키가 팔레트·`QASM_OPS` 에 실재하는가 — 뿐이고 지금은 양쪽 6/6 이다. 두 표 모두 import 가 안 돼(`QISKIT_NAME` 은 export 가 아니고 `main.js` 는 Node 에서 뜨지 않는다) `parsePaletteCategories` 식 텍스트 파싱이 든다. 실제 구멍은 테스트 쪽이다 — 이름이 다른 예외(`rcccx`·`mcx`)의 출력을 단언하는 테스트가 없다 |
