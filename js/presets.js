// 회로 프리셋. [2] 기존 공유 URL과 동일한 직렬화 문자열(circuit)로만 저장한다(별도 자료구조 없음).
// 로드 = decodeCircuit(circuit) → 회로에 적용. 큐비트 수도 문자열에 담겨 자동 설정된다.
// circuit 문자열은 각 회로를 canonical 그리드로 만들어 encodeCircuit로 생성하고 simulate로
// 기대 상태와 대조 검증했다(test/presets.test.mjs가 로드 후 상태벡터를 재검증한다).
export const PRESETS = [
  {
    name: "Bell state (Φ+)",
    description: "Maximally entangled pair — (|00⟩+|11⟩)/√2",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlgiLCJ0ZyI6WzFdLCJ4IjpbMF19XX0",
  },
  {
    name: "GHZ state",
    description: "3-qubit maximal entanglement — (|000⟩+|111⟩)/√2",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlgiLCJ0ZyI6WzFdLCJ4IjpbMF19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMV19XX0",
  },
  {
    name: "W state",
    description: "3-qubit W state — (|001⟩+|010⟩+|100⟩)/√3",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMF19LHsiYyI6MSwiZyI6IlJZIiwidGciOlsxXSwieCI6WzBdLCJwIjp7InQiOjEuOTEwNjMzfX0seyJjIjoyLCJnIjoiWCIsInRnIjpbMF0sIngiOlsxXX0seyJjIjozLCJnIjoiUlkiLCJ0ZyI6WzJdLCJ4IjpbMV0sInAiOnsidCI6MS41NzA3OTZ9fSx7ImMiOjQsImciOiJYIiwidGciOlsxXSwieCI6WzJdfV19",
  },
  {
    name: "Phase kickback",
    description: "CNOT on |±⟩ kicks a phase back to the control",
    qubits: 2,
    circuit: "eyJ2IjoyLCJuIjoyLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MCwiZyI6IlgiLCJ0ZyI6WzFdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoyLCJnIjoiWCIsInRnIjpbMV0sIngiOlswXX1dfQ",
  },
  {
    name: "Deutsch–Jozsa",
    description: "Balanced oracle (f = x₀⊕x₁) — inputs collapse to |11⟩",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiWCIsInRnIjpbMl19LHsiYyI6MSwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjEsImciOiJIIiwidGciOlsxXX0seyJjIjoxLCJnIjoiSCIsInRnIjpbMl19LHsiYyI6MiwiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMF19LHsiYyI6MywiZyI6IlgiLCJ0ZyI6WzJdLCJ4IjpbMV19LHsiYyI6NCwiZyI6IkgiLCJ0ZyI6WzBdfSx7ImMiOjQsImciOiJIIiwidGciOlsxXX1dfQ",
  },
  {
    name: "Quantum Fourier Transform",
    description: "3-qubit QFT — H · controlled-phase · SWAP",
    qubits: 3,
    circuit: "eyJ2IjoyLCJuIjozLCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMl19LHsiYyI6MSwiZyI6IlAiLCJ0ZyI6WzJdLCJ4IjpbMV0sInAiOnsidCI6MS41NzA3OTZ9fSx7ImMiOjIsImciOiJQIiwidGciOlsyXSwieCI6WzBdLCJwIjp7InQiOjAuNzg1Mzk4fX0seyJjIjozLCJnIjoiSCIsInRnIjpbMV19LHsiYyI6NCwiZyI6IlAiLCJ0ZyI6WzFdLCJ4IjpbMF0sInAiOnsidCI6MS41NzA3OTZ9fSx7ImMiOjUsImciOiJIIiwidGciOlswXX0seyJjIjo2LCJnIjoiU1dBUCIsInRnIjpbMCwyXX1dfQ",
  },
];
