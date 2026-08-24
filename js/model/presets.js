// 회로 프리셋(Quirk 스타일 Example Circuits). [2] 기존 공유 URL과 동일한 직렬화 문자열(circuit)로만
// 저장한다(별도 자료구조 없음). 로드 = decodeCircuit(circuit) → 회로에 적용, 큐비트 수도 자동 설정.
// circuit 문자열은 각 회로를 canonical 그리드로 encodeCircuit해 생성하고 simulate로 기대 상태와
// 대조 검증했다(test/presets.test.mjs가 로드 후 상태벡터를 재검증한다 — 틀린 프리셋 추가 금지).
// category는 UI 그룹 표시용 메타데이터일 뿐(회로 저장 구조와 무관).
export const PRESET_CATEGORIES = ["Basics", "Algorithms", "Protocols"];

export const PRESETS = [
  // ---- Basics ----
  {
    name: "Bell state (Φ+)",
    description: "Maximally entangled pair — (|00⟩+|11⟩)/√2",
    category: "Basics",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlgiLCJ0ZyI6WzFdLCJ4IjpbMF19XX0",
  },
  {
    name: "GHZ state",
    description: "3-qubit maximal entanglement — (|000⟩+|111⟩)/√2",
    category: "Basics",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlgiLCJ0ZyI6WzFdLCJ4IjpbMF19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMV19XX0",
  },
  {
    name: "W state",
    description: "3-qubit W state — (|001⟩+|010⟩+|100⟩)/√3",
    category: "Basics",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlJZIiwidGciOlsxXSwieCI6WzBdLCJwIjp7InQiOjEuOTEwNjMzfX0seyJjIjoyLCJnIjoiWCIsInRnIjpbMF0sIngiOlsxXX0seyJjIjozLCJnIjoiUlkiLCJ0ZyI6WzJdLCJ4IjpbMV0sInAiOnsidCI6MS41NzA3OTZ9fSx7ImMiOjQsImciOiJYIiwidGciOlsxXSwieCI6WzJdfV19",
  },
  {
    name: "Phase kickback",
    description: "CNOT on |±⟩ kicks a phase back to the control",
    category: "Basics",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MCwiZyI6IlgiLCJ0ZyI6WzFdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoyLCJnIjoiWCIsInRnIjpbMV0sIngiOlswXX1dfQ",
  },

  // ---- Algorithms ----
  {
    name: "Deutsch–Jozsa (balanced)",
    description: "Balanced oracle (f = x₀⊕x₁) — inputs collapse to |11⟩",
    category: "Algorithms",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMl19LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoxLCJnIjoiSCIsInRnIjpbMl19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMF19LHsiYyI6MywiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMV19LHsiYyI6NCwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjQsImciOiJIIiwidGciOlsxXX1dfQ",
  },
  {
    name: "Deutsch–Jozsa (constant)",
    description: "Constant oracle (f = 1) — inputs collapse to |00⟩",
    category: "Algorithms",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMl19LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoxLCJnIjoiSCIsInRnIjpbMl19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzJdfSx7ImMiOjMsImciOiJIIiwidGciOlswXX0seyJjIjozLCJnIjoiSCIsInRnIjpbMV19XX0",
  },
  {
    name: "Bernstein–Vazirani",
    description: "Recovers the secret string s = 101 in one query",
    category: "Algorithms",
    qubits: 4,
    circuit: "eyJ2IjoyLCJuIjo0LCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbM119LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoxLCJnIjoiSCIsInRnIjpbMl19LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzNdfSx7ImMiOjIsImciOiJYIiwidGciOlszXSwieCI6WzBdfSx7ImMiOjMsImciOiJYIiwidGciOlszXSwieCI6WzJdfSx7ImMiOjQsImciOiJIIiwidGciOlswXX0seyJjIjo0LCJnIjoiSCIsInRnIjpbMV19LHsiYyI6NCwiZyI6IkgiLCJ0ZyI6WzJdfV19",
  },
  {
    name: "Grover search",
    description: "2-qubit Grover — 1 iteration finds |11⟩ with certainty",
    category: "Algorithms",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MCwiZyI6IkgiLCJ0ZyI6WzFdfSx7ImMiOjEsImciOiJaIiwidGciOlswXSwieCI6WzFdfSx7ImMiOjIsImciOiJIIiwidGciOlswXX0seyJjIjoyLCJnIjoiSCIsInRnIjpbMV19LHsiYyI6MywiZyI6IlgiLCJ0ZyI6WzBdfSx7ImMiOjMsImciOiJYIiwidGciOlsxXX0seyJjIjo0LCJnIjoiWiIsInRnIjpbMF0sIngiOlsxXX0seyJjIjo1LCJnIjoiWCIsInRnIjpbMF19LHsiYyI6NSwiZyI6IlgiLCJ0ZyI6WzFdfSx7ImMiOjYsImciOiJIIiwidGciOlswXX0seyJjIjo2LCJnIjoiSCIsInRnIjpbMV19XX0",
  },
  {
    name: "Quantum Fourier Transform",
    // |000⟩ 에 QFT 를 걸면 위상이 전부 0이라 H⊗H⊗H 와 구별되지 않는다 —
    // QFT 의 핵심인 위상 회전이 전혀 드러나지 않는다. 앞에 X 를 하나 두어 |001⟩ 로 넣는다.
    description: "3-qubit QFT on |001⟩ — phases step by π/4 around the circle",
    category: "Algorithms",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzJdfSx7ImMiOjIsImciOiJQIiwidGciOlsyXSwieCI6WzFdLCJwIjp7InQiOjEuNTcwNzk2fX0seyJjIjozLCJnIjoiUCIsInRnIjpbMl0sIngiOlswXSwicCI6eyJ0IjowLjc4NTM5OH19LHsiYyI6NCwiZyI6IkgiLCJ0ZyI6WzFdfSx7ImMiOjUsImciOiJQIiwidGciOlsxXSwieCI6WzBdLCJwIjp7InQiOjEuNTcwNzk2fX0seyJjIjo2LCJnIjoiSCIsInRnIjpbMF19LHsiYyI6NywiZyI6IlNXQVAiLCJ0ZyI6WzAsMl19XX0",
  },

  // ---- Protocols ----
  {
    // 교과서 형태(중간 측정 + 조건부 보정). 시뮬레이션은 지연 측정 변환으로 처리되며,
    // 예전 coherent(CX/CZ) 버전과 계산 결과가 동일하다.
    name: "Quantum teleportation",
    description: "Measure q0·q1, then conditional X/Z move q0's state to q2",
    category: "Protocols",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MCwiZyI6IkgiLCJ0ZyI6WzFdfSx7ImMiOjEsImciOiJUIiwidGciOlswXX0seyJjIjoxLCJnIjoiWCIsInRnIjpbMl0sIngiOlsxXX0seyJjIjoyLCJnIjoiWCIsInRnIjpbMV0sIngiOlswXX0seyJjIjozLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6NCwiZyI6Ik1FQVNVUkUiLCJ0ZyI6WzBdLCJwIjp7ImNiIjowfX0seyJjIjo0LCJnIjoiTUVBU1VSRSIsInRnIjpbMV0sInAiOnsiY2IiOjF9fSx7ImMiOjUsImciOiJYIiwidGciOlsyXSwicCI6eyJjaSI6MX19LHsiYyI6NiwiZyI6IloiLCJ0ZyI6WzJdLCJwIjp7ImNpIjowfX1dfQ",
  },
  {
    name: "Superdense coding",
    description: "Send 2 classical bits (11) with one qubit — decodes to |11⟩",
    category: "Protocols",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlgiLCJ0ZyI6WzFdLCJ4IjpbMF19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzBdfSx7ImMiOjMsImciOiJaIiwidGciOlswXX0seyJjIjo0LCJnIjoiWCIsInRnIjpbMV0sIngiOlswXX0seyJjIjo1LCJnIjoiSCIsInRnIjpbMF19XX0",
  },
];
