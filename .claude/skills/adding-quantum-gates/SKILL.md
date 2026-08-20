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

## 정보 출처

근거로 쓸 수 있는 것은 이 리포 안의 파일과 검증 스크립트 출력뿐이다.
기술 정보에는 출처를 붙인다 — **파일 + 심볼 이름** (예: `js/main.js` 의
`GATE_CATEGORY.CZ`). 줄 번호는 쓰지 않는다. 게이트를 추가하면 좌표가 밀린다.

### QASM · Qiskit 이름은 추측하지 않는다

`js/qasm.js` 의 `QASM_OPS` 에 있는 `qasm` 값과 `js/export.js` 의 `QISKIT_NAME` 값은
외부 표준 이름이다. **리포에 이미 있는 이름만 확실한 것으로 다룬다.**

비제어 신규 게이트(`fixed`·`param`·`swap`·`pair-param`)는 QASM 행이 필요한데,
리포의 비제어 QASM 이름은 전부 기존 게이트에 매핑돼 있어 빈자리가 없다.
**따라서 이런 게이트는 외부 스펙 확인 없이는 완결되지 않는다.**

- "이 QASM 이름은 리포에서 확인되지 않습니다 — 공식 스펙 확인이 필요합니다"라고 명시
- 추측한 이름으로 행을 넣지 않는다. 존재하지 않는 연산자를 넣으면 내보낸 코드가
  다른 회로가 되고, 검증 스크립트는 행의 존재만 보므로 잡지 못한다

### 불확실 표현은 검증 수단이 없을 때만

- "이 QASM 이름은 리포에서 확인되지 않습니다 — 공식 스펙 확인이 필요합니다."
- "이 게이트가 기존 base + 컨트롤로 이미 표현 가능한지 확인이 필요합니다."

테스트로 확인할 수 있는 것은 말로 넘기지 않는다 — 분해가 표준과 일치하는지,
`defaultTheta` 가 맞는지는 **테스트로 확인한다.**

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

- **`js/gatematrix.js`** — 엔진에 기저 벡터를 통과시켜 행렬을 유도하므로 새 게이트가
  자동으로 정확해진다. 여기에 행렬을 적으면 분해를 두 벌 두는 셈이라 어긋난다.
  예외: `localLayout` 의 `kind: "decomposed"` 분기.
- **`js/export.js` 의 게이트 이름** — 매핑은 `QASM_OPS` 하나뿐이다.
  `QISKIT_NAME` 은 이름이 다를 때만 쓰는 예외 표지, 게이트 목록이 아니다.
- **`style.css`** — 기존 카테고리에 넣는 것뿐이면 손대지 않는다.

## 절차

0. **제어형이라면 `js/qasm.js` 의 `opFor(base, controls)` 가 QASM 이름을 돌려주는지
   먼저 확인한다.**
   - 이름이 나오면 진행한다. 팔레트 슬롯을 줄 만큼 흔한 게이트인지만 판단한다.
   - `null` 이면 추가하지 마라. 내보내기에서 게이트가 아니라 `cannot be represented`
     **주석**으로 나간다 — 경고가 함께 나오지만 **회로가 온전히 내보내지지 않는 건
     같다.** 그리고 검사 D 가 `controlled` 를 면제하므로 **검증 스크립트는 exit 0 으로
     통과한다** — 위험은 내보내기의 침묵이 아니라 이 거짓 통과다.
     내보내기까지 지원하려면 별도 방출 경로가 필요하고 이 스킬의 범위 밖이다.

   "표현 가능하면 추가하지 마라"는 규칙이 아니다 — `CNOT`·`CZ`·`CCX`·`CSWAP` 이
   전부 base + `CTRL` 로 표현 가능한데도 `GATE_INFO` 에 있다.

1. `js/quantum.js` 의 `GATE_INFO` 에 항목을 추가한다. `kind` 를 먼저 정하면
   나머지 필수 필드가 따라온다 → [reference.md](./reference.md)
2. `kind` 가 `fixed`/`param` 이면 같은 파일에 행렬을 추가한다.
   1큐비트 유니터리면 `SINGLE_QUBIT_GATES` 에도 이름을 넣는다.
3. `js/main.js` 의 `PALETTE_CATEGORIES` 에서 알맞은 카테고리의 `gates` 에 넣는다.
   **`GATE_INFO[].group` 과 카테고리 `id` 는 서로 다른 분류 체계다** — `group` 값을
   그대로 카테고리로 쓰지 마라.
4. QASM 이름이 있으면 `js/qasm.js` 의 `QASM_OPS` 에 행을 추가한다.
   제어형은 base + `nc` 로 표현되면 새 행이 필요 없다.
5. 테스트를 추가한다. `defaultTheta` 와 분해가 맞는지도 여기서 확인한다.
6. 검증 스크립트와 테스트를 돌린다.

## 스크립트 사용

### scripts/verify-gate-registration.mjs

```bash
node ${CLAUDE_SKILL_DIR}/scripts/verify-gate-registration.mjs
```

- **입력**: 없음. cwd 에 의존하지 않고 스크립트 위치에서 리포 루트를 유도한다
- **출력**: 누락이 없으면 무출력. 있으면 `검사명: 게이트들` 과 `→ 고칠 위치`
- **종료 코드**: `0` 통과 / `1` 누락 발견 또는 리포 루트·파싱 실패
- **오류 처리**: 리포 루트를 못 찾거나 `PALETTE_CATEGORIES` 파싱에 실패하면
  어느 파일의 무엇인지 찍고 exit 1

| 검사 | 내용 |
|---|---|
| A | `GATE_INFO` 에 있는데 팔레트에 없다 |
| B | 팔레트에 있는데 `GATE_INFO` 에 없다 |
| C | `QASM_OPS` 가 참조하는데 `GATE_INFO` 에 없다 |
| D | `GATE_INFO` 에 있는데 QASM 표에 없다 |
| E | 행렬이 있어야 하는데 `matrixFor` 가 실패한다 |
| F | 팔레트 카테고리에 대응하는 CSS 변수가 없다 |

**exit 0 이어도 확인해야 하는 것** — 검사 범위 밖이다:
- `qasm` 값이 실재하는 OpenQASM 연산자인지 (행의 존재만 본다)
- 제어형의 `opFor(base, controls)` 가 `null` 인지 (검사 D 가 면제한다)
- `SINGLE_QUBIT_GATES`·`PALETTE_GLYPHS`·`QISKIT_NAME` 등록 여부

```bash
node --test    # 220개 기준선
```

## 예시 — 제어형 게이트 (CY)

`js/quantum.js` 의 `GATE_INFO`:

```js
CY: { label: "CY", targetLabel: "Y", kind: "controlled", base: "Y", controls: 1,
      group: "pauli", ready: true, minQubits: 2, desc: "CY — controlled Y" },
```

`js/main.js` 의 `PALETTE_CATEGORIES`:

```js
{ id: "multi", label: "Multi-qubit", gates: ["CTRL", "CNOT", "CY", "CCX", "SWAP", "CSWAP"] },
```

- 행렬 **불필요** — `kind: "controlled"` 는 base 게이트와 컨트롤로 조립된다.
  필드 형태는 같은 파일의 `CZ` 항목을 본보기로 본다
- `QASM_OPS` 행 **불필요** — `opFor("Y", 1)` 이 `cy` 를 돌려준다
- `group` 은 `pauli` 지만 팔레트 카테고리는 `multi` 다. 두 값은 일치하지 않는다

## 반례 — CS 는 추가하지 않는다

`CS` 는 `base: "S", controls: 1` 인데 `opFor("S", 1)` 이 `null` 이다. 넣으면
내보내기가 `// cannot be represented in OpenQASM 2.0: S with 1 control(s)` 주석과
경고를 낸다. **그런데 검증 스크립트는 exit 0 으로 통과한다** — 검사 D 가
`controlled` 를 면제하기 때문이다. 같은 `controlled` 인데 CY 는 되고 CS 는 안 된다
— **`kind` 만 보고 판단하지 마라. 절차 0번을 거쳐라.**

상세 레퍼런스: [reference.md](./reference.md)
