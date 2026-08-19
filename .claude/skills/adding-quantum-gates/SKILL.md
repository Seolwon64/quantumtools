---
name: adding-quantum-gates
description: 블로흐 구 앱에 새 양자 게이트를 등록한다. GATE_INFO·팔레트·QASM 표에 빠짐없이 넣고 자동 유도되는 파일은 건드리지 않는다. 게이트 추가·수정, 팔레트 변경, QASM/Qiskit 내보내기에 게이트가 빠졌을 때 사용
when_to_use: >-
  "게이트 추가해줘", "CH 게이트 넣어줘", "팔레트에 게이트가 안 보인다",
  "QASM 내보내기에 게이트가 빠진다" 같은 요청
---

# 양자 게이트 추가

게이트 하나가 여러 레지스트리에 흩어져 등록된다. 어려운 건 코드가 아니라
**어디를 고치고 어디를 고치지 않는가**다.

## 등록 지점

| 파일 | 무엇을 | 언제 |
|---|---|---|
| `js/quantum.js` | `GATE_INFO` 항목 | 항상 |
| `js/quantum.js` | 행렬 — `FIXED_MATRICES` 또는 `PARAM_MATRIX_BUILDERS` | `kind`가 `fixed`/`param`일 때 |
| `js/quantum.js` | `SINGLE_QUBIT_GATES` 에 이름 추가 | 1큐비트 유니터리일 때 |
| `js/main.js` | `PALETTE_CATEGORIES` 의 `gates` 배열 | 팔레트에 노출할 때 |
| `js/main.js` | `PALETTE_GLYPHS` | 다중 큐비트 글리프가 필요할 때만 |
| `js/qasm.js` | `QASM_OPS` 행 | 고유 QASM 이름이 있을 때 |
| `js/export.js` | `QISKIT_NAME` | QASM 이름과 Qiskit 메서드명이 **다를 때만** |
| `style.css` | `--cat-<id>` 3종 (base/border/hover) | **새 카테고리**를 만들 때만 |
| `test/` | 테스트 | 항상 |

## 건드리지 말 것

- **`js/gatematrix.js`** — 게이트별 행렬을 유도하지 않는다. 엔진에 기저 벡터를
  통과시켜 열을 얻으므로 새 게이트가 자동으로 정확해진다. 여기에 행렬을 적으면
  분해를 두 벌 두는 셈이라 반드시 어긋난다. 예외: `kind: "decomposed"` 전용 분기.
- **`js/export.js` 의 게이트 이름** — 매핑은 `QASM_OPS` 표 하나뿐이다.
  `QISKIT_NAME` 은 이름이 다를 때만 쓰는 예외 표지, 게이트 목록이 아니다.
- **`style.css`** — 기존 카테고리에 게이트를 넣는 것뿐이면 CSS는 손대지 않는다.

## 절차

1. `js/quantum.js` 의 `GATE_INFO` 에 항목을 추가한다. `kind` 를 먼저 정하면
   나머지 필수 필드가 따라온다 → [reference.md](./reference.md)
2. `kind` 가 `fixed`/`param` 이면 같은 파일에 행렬을 추가한다.
   1큐비트 유니터리면 `SINGLE_QUBIT_GATES` 에도 이름을 넣는다.
3. `js/main.js` 의 `PALETTE_CATEGORIES` 에서 알맞은 카테고리의 `gates` 에 넣는다.
   **`GATE_INFO[].group` 과 카테고리 `id` 는 서로 다른 분류 체계다** — `group` 값을
   그대로 카테고리로 쓰지 마라.
4. QASM 이름이 있으면 `js/qasm.js` 의 `QASM_OPS` 에 행을 추가한다.
   제어형은 base 게이트 + `nc` 로 표현되면 새 행이 필요 없다.
5. 테스트를 추가한다.
6. 검증 스크립트와 테스트를 돌린다.

## 검증

```bash
node ${CLAUDE_SKILL_DIR}/scripts/verify-gate-registration.mjs
node --test
```

검증 스크립트는 입력이 없고 cwd 에 의존하지 않는다.
누락이 없으면 **무출력 + exit 0**, 있으면 항목별 목록과 고칠 위치를 찍고 **exit 1**.

검사 항목: A 팔레트 누락 · B 팔레트에만 있는 이름 · C QASM 이 참조하는 미정의 게이트 ·
D QASM 표 누락 · E 행렬 누락 · F 카테고리 CSS 변수 누락.

리포 루트를 못 찾으면 그 사실을 찍고 exit 1 한다 — 스크립트가 제자리에 없다는 뜻이다.

## 예시 — 1큐비트 고정 게이트

`js/quantum.js`:

```js
// GATE_INFO
CH: { label: "CH", targetLabel: "H", kind: "controlled", base: "H", controls: 1,
      group: "hadamard", ready: true, minQubits: 2, desc: "CH — controlled Hadamard" },
```

`kind: "controlled"` 이므로 행렬을 적지 않는다 — base 게이트 `H` 와 컨트롤로 조립된다.
같은 이유로 `QASM_OPS` 행도 `{ qasm: "ch", gate: "H", nc: 1, nt: 1 }` 이 된다.

`js/main.js`:

```js
{ id: "multi", label: "Multi-qubit", gates: ["CTRL", "CNOT", "CCX", "SWAP", "CSWAP", "CH"] },
```

`group` 은 `hadamard` 지만 팔레트 카테고리는 `multi` 다. 두 값은 일치하지 않는다.

상세 레퍼런스: [reference.md](./reference.md)
