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
| **끝에 있는 RESET 이 사후선택으로 계산된다** — 화면이 틀린 확률을 조용히 보여 준다 | 9단계 | `trajectory.js` `needsTrajectorySampling`(RESET 을 붕괴로만 보고 "뒤에 연산이 없으면" 이론 경로), `quantum.js` `applyReset`(이론 경로에서는 사영) | 재현: `H q0 · CX q0,q1 · RESET q0` → 화면 `\|00⟩` 100%. 궤적 2000개 평균 P(q1=1) = 50.8%. RESET 뒤에 연산이 있으면 궤적 경로로 가서 맞다. quantum-spec 5절의 규칙("RESET 은 궤적 경로에서만 정확하다") 위반 |
| 편집 후 Apply 가 코드로 표현되지 않는 게이트를 경고 없이 지운다 | 6단계 | `codepanel.js` Apply 경로, `qasm.js` 매핑 표 | 사용자는 지워진 줄 모른다. quantum-spec "QASM / Qiskit 왕복 계약" 의 "조용히 넘어가지 않는다" 와 같은 성격 |
| 파라미터 팝오버가 건드리지 않은 φ·λ 를 바꾼다 | 8단계 | `popover.js` `openParamEditor` | θ 만 바꿔 Apply → φ 1.235 → 1.239, λ 2.346 → 2.339(U 게이트, 8단계 실측). 원인 미확인 |

## 중간

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| 회로 키보드 탐색이 없다 — 게이트 조작 전체가 마우스 전용이고, 배치된 칩에 역할·이름이 없다 | 8단계 | `grid.js` `buildCircuitGrid`(칩·제어점 `tabindex="-1"`, role 없음), `gatemenu.js` `openMenuForCell`(포인터 좌표로 연다) | 게이트 정보도 마우스로만 열린다. 그리드를 통째로 다시 그려 생기는 스크린리더 재읽기(design-spec "알려진 한계")의 근본 해결도 여기서 |
| 프리셋을 고르면 포커스가 body 로 떨어진다 | 8단계 | `main.js` 프리셋 메뉴(`.preset-item`) | design-spec "원칙 — 포커스와 Esc" 의 "숨는 요소의 포커스는 옮긴다" 위반 |
| 파라미터 팝오버가 열릴 때 포커스를 가져가지 않는다 | 8단계 | `popover.js` `openParamEditor` | 같은 원칙의 "사용자가 열면 그 안의 첫 자리로" 위반 |
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
| 지연 변환의 거부 경로가 아직 화면에 닿는지 확인 | 9단계 | `circuit.js` `validate`·`stateAt`, `classical.js` `resolveDeferred` | 측정 뒤 조작·조건부 회로는 판정 순서상 궤적이 먼저 받는다. 거부 메시지가 나오는 회로가 남았는지 확인하고, 없으면 죽은 경로다 |

## 디자인 재작성 과제

| 과제 | 출처 | 근거 | 메모 |
|---|---|---|---|
| 상태 표시와 상호작용이 모두 액센트다 | 8·9단계 | `style.css` 액센트 토큰 주석, `.selected`(outline), `.info-target`(후광), 재생 진행 점선, focus-visible 링 | design-spec "색상 — 3층 구조" 의 "액센트는 누를 수 있는 것 전용" 과 충돌한다. 규칙은 의도로 남겼다 — 재작성에서 상태 표시용 색을 따로 둘지 정한다 |
