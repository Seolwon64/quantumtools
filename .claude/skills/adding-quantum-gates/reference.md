# 게이트 등록 상세 레퍼런스

출처는 **파일 + 심볼 이름**으로 적는다. 줄 번호는 쓰지 않는다 — 이 스킬이 하는 일이
`GATE_INFO` 에 항목을 넣는 것이라, 게이트를 하나 추가할 때마다 아래 좌표가 전부 밀려
스킬이 성공할 때마다 자기 문서를 무효화하게 된다.

## `kind` 별 필수 필드

`kind` 가 나머지 필드와 행렬 필요 여부를 결정한다.
정의처는 `js/quantum.js` 의 `GATE_INFO`, 행렬은 같은 파일의 `FIXED_MATRICES` ·
`PARAM_MATRIX_BUILDERS` · `uMatrix` 다.

| `kind` | 추가 필수 필드 | 행렬 | 예 |
|---|---|---|---|
| `fixed` | — | `FIXED_MATRICES` | H, X, Y, Z, S, Sdg, T, Tdg, I, SX, SXdg |
| `param` | `defaultTheta` | `PARAM_MATRIX_BUILDERS` | RX, RY, RZ, P |
| `param3` | `defaultTheta` | **없음** — `uMatrix()` 가 처리 | U |
| `controlled` | `base`, `controls`, `minQubits` | 없음 — base + 컨트롤로 조립 | CNOT, CZ, CCX |
| `swap` | `minQubits` | 없음 — 엔진 전용 처리 | SWAP |
| `cswap` | `controls`, `minQubits` | 없음 | CSWAP |
| `pair-param` | `defaultTheta`, `minQubits` | 없음 | RXX, RYY, RZZ |
| `decomposed` | `qubits`, `controls`, `minQubits` | 없음 — 분해 단계로 정의 | RCCX, RC3X |
| `dot` | — | 없음 | CTRL, IF |
| `reset` | — | 없음 | RESET |
| `noop` | — | 없음 | BARRIER, MEASURE |

## `GATE_INFO` 필드

| 필드 | 의미 |
|---|---|
| `label` | 팔레트·회로 칩에 찍히는 문자 |
| `targetLabel` | 회로 캔버스에서 타깃 칸에 찍히는 문자 (`⊕`, `×`, `Z` 등). 없으면 `label` |
| `kind` | 위 표 |
| `group` | **색상 분류용.** 팔레트 카테고리와 다른 체계다 (아래 참조) |
| `ready` | 렌더링 여부. 미구현 게이트를 정의만 남기고 감출 때 `false` |
| `minQubits` | 배치에 필요한 최소 큐비트 수. 팔레트 비활성 판단용 |
| `defaultTheta` | 파라미터 게이트의 기본 각도 |
| `base` | `controlled` 가 조립할 1큐비트 게이트 이름 |
| `controls` | 컨트롤 개수 |
| `qubits` | `decomposed` 가 쓰는 총 큐비트 수 |
| `desc` | 게이트 정보 패널 문구 |

## 함정 — 분류 체계가 둘이다

`js/quantum.js` 의 `GATE_INFO[].group` 과 `js/main.js` 의 `PALETTE_CATEGORIES[].id` 는
**별개이고 값도 다르다.**

| 게이트 | `group` (quantum.js) | 팔레트 카테고리 (main.js) |
|---|---|---|
| H | `hadamard` | `pauli` |
| Y | `rotation` | `pauli` |
| Z, S, Sdg | `phase` | `pauli` |
| SX, SXdg | `rotation` | `pauli` |
| CZ, CSWAP | `control` | `multi` |
| RXX/RYY/RZZ | `rotation` | `interaction` |

`group` 값을 카테고리로 그대로 쓰면 게이트가 엉뚱한 묶음에 들어간다.
카테고리는 `PALETTE_CATEGORIES` 에서 직접 고른다.

`GATE_CATEGORY` 는 `PALETTE_CATEGORIES` 에서 파생되지만, **팔레트에 없는 게이트는
수동으로 넣어야 한다.** `js/main.js` 의 `GATE_CATEGORY.CZ` 수동 지정이 그 예다 —
CZ 는 팔레트에 없지만 공유 회로로 캔버스에 올 수 있어 색이 필요하다.

## `QASM_OPS` 행

`js/qasm.js` 의 `QASM_OPS`.

```js
{ qasm: "rzz", gate: "RZZ", nc: 0, nt: 2, params: ["theta"] }
```

| 필드 | 의미 |
|---|---|
| `qasm` | OpenQASM 연산 이름 |
| `gate` | 대응하는 `GATE_INFO` 키 |
| `nc` | 컨트롤 큐비트 수 |
| `nt` | 타깃 큐비트 수 |
| `params` | 파라미터 이름 순서. `["theta"]`, `["theta","phi","lambda"]` |

**제어형은 base 게이트로 매핑한다.** 별도 `gate` 값을 만들지 않는다:

```js
{ qasm: "cx",  gate: "X", nc: 1, nt: 1 }
{ qasm: "ccx", gate: "X", nc: 2, nt: 1 }
{ qasm: "cz",  gate: "Z", nc: 1, nt: 1 }
```

그래서 `CNOT`·`CZ`·`CCX`·`CSWAP` 은 `GATE_INFO` 에 있어도 자기 이름의 `QASM_OPS` 행이
없다. `CTRL`·`BARRIER`·`MEASURE`·`RESET`·`IF` 도 구조·비유니터리라 별도 방출 경로를 탄다.
검증 스크립트는 이걸 `kind` 규칙으로 면제한다.

표준 qelib1.inc 를 넘어 Qiskit 확장까지 커버한다 — 표준만 고집하면 MCX 같은 게이트가
주석으로 빠져 **내보낸 코드가 다른 회로**가 된다.

## 제어형이 실제로 전개되는 지점 — `migrateCell`

`js/circuit.js` 의 `migrateCell` 이 배치 시점에 `kind: "controlled"` 를 **base + 컨트롤로
바꾼다.** 그리드에는 `gate: "CNOT"` 이 아니라 `gate: "X", controls: [...]` 가 들어간다.

```
migrateCell({gate:"CNOT", controls:[0]}, 1) → {gate:"X", targets:[1], controls:[0]}
migrateCell({gate:"CZ",   controls:[0]}, 1) → {gate:"Z", targets:[1], controls:[0]}
```

그래서 내보내기는 `js/qasm.js` 의 `opFor(base, controlCount)` 로 조회한다.
**`opFor` 가 `null` 이면 표현 불가**이고, 그 자리는 게이트가 아니라 주석으로 나간다.

```
opFor("Y", 1) → { qasm: "cy", ... }     CY 는 정상 내보내짐
opFor("S", 1) → null                    CS 는 주석 + 경고
opFor("Z", 2) → null                    CCZ 도 마찬가지
```

검사 D 는 `controlled` 를 면제하므로(base + `nc` 로 내보내니 고유 행이 필요 없다)
이 실패를 D 로는 잡을 수 없다. **검사 H 가 이걸 별도로 담당한다.**

`GATE_INFO` 항목을 손으로 만든 그리드 셀로 시험하면 이 전개를 우회해 잘못된 결론이
나온다. 반드시 `migrateCell` 을 통과시켜 확인한다.

## `QISKIT_NAME`

`js/export.js` 의 `QISKIT_NAME`.
QASM 이름과 Qiskit 메서드명이 다를 때만 쓰는 예외 표지다. 게이트 목록이 아니다.

```js
const QISKIT_NAME = { id: "id", sdg: "sdg", sxdg: "sxdg", rc3x: "rcccx", c3x: "mcx", c4x: "mcx" };
```

새 게이트의 QASM 이름이 Qiskit 메서드명과 같으면 **아무것도 추가하지 않는다.**

## `gatematrix.js` 가 행렬을 얻는 방식

`js/gatematrix.js` 의 `gateMatrix` · `localLayout`.

게이트별 2^n 행렬을 새로 유도하지 않는다. 관여 큐비트를 로컬 인덱스로 리맵한 뒤
**엔진(`js/quantum.js` 의 `applyPlacement`)에 기저 벡터 e_j 를 통과시켜 j번째 열**을 얻는다.
SWAP·RXX·RCCX 처럼 "행렬이 코드에 없는" 게이트도 자동으로 정확하다.

로컬 비트 순서는 **타깃이 최하위 비트**(로컬 q0), 그 위로 컨트롤이다.

`localLayout` 에 `kind === "decomposed"` 전용 분기가 있다 — RCCX/RC3X 는
`targets = [a, b, (c), t]` 로 마지막이 타깃이고 앞이 전부 컨트롤이다. 새 `decomposed`
게이트를 추가하면 이 분기를 확인한다.

로컬 배치를 역할 순이 아니라 **큐비트 번호 순**으로 놓는다. 역할 순으로 고정하면
`RCCX(a,b)` 와 `RCCX(b,a)` 가 같은 행렬이 되어 두 배치의 차이가 드러나지 않는다.

## 카테고리 CSS 변수

`js/main.js` 의 `PALETTE_CATEGORIES` 의 `id` 마다 `style.css` 의 `--cat-*` 3종이 필요하다:

```css
--cat-<id>: …;          /* 배경 */
--cat-<id>-border: …;   /* 테두리 — 같은 hue, 더 어둡게 */
--cat-<id>-hover: …;    /* hover */
```

기존 카테고리에 게이트를 넣는 것뿐이면 CSS는 손대지 않는다.
