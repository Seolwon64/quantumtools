Quantum Tools

An interactive quantum circuit simulator and state visualizer that runs entirely in the browser. Build circuits by dragging gates, watch the statevector evolve step by step, and inspect the result through a 3D Bloch sphere, a Q-sphere, and a probability chart.

Live demo: https://seolwon64.github.io/quantumtools/

<!-- Replace with a hero screenshot of the full interface -->

Why I built this
<!-- TODO — write this yourself. This is the part readers care about most. A few honest sentences: what problem you had, why existing tools (Qiskit, Quirk, IBM Composer) didn't fully solve it for you, and what you wanted to understand by building it. Example angle: "I was moving from CS toward physics and wanted to *see* what a gate does to a state, not just read the matrix — so I built a tool where the matrix, the circuit, and the geometry are all on screen at once." -->

(placeholder — to be written)

Features
Visual circuit builder — place gates on a multi-qubit grid, step through execution, and scrub back and forth.
Arbitrary controlled gates — any single-qubit gate can take any number of control qubits. CNOT, CCX, CZ, CSWAP, MCX/MCZ and more all come from one general gate + controls model rather than hard-coded special cases.
3D Bloch sphere — per-qubit state as an interactive, rotatable sphere.
Q-sphere — whole-state view for up to 5 qubits, with node position for basis state and color for phase.
Probability chart — measurement probabilities with a zero-state hiding toggle for large state spaces.
Measurement sampling — run a configurable number of shots and compare sampled counts against the theoretical distribution.
Statevector display — the live state as a complex superposition, with endianness clearly labeled (|q2 q1 q0⟩, Qiskit convention).
Code export — export any circuit to OpenQASM / Qiskit.
Shareable circuits — the full circuit is encoded in the URL, so any state can be shared with a link.
Undo / redo — full history, including recovery from "Clear all".

Gate set

Pauli & Clifford (H, X, Y, Z, I, S, S†, √X, √X†), phase gates (T, T†, P, RZ), rotations (RX, RY, U), interaction gates (RXX, RYY, RZZ), non-unitary operations (Measure, Reset, Barrier), and relative-phase Toffolis (RCCX, RC3X) implemented as their exact unitaries rather than approximated as CCX/C3X.

Tech stack
Vanilla JavaScript (ES modules) — no framework, minimal dependencies.
Three.js — Bloch sphere and Q-sphere rendering.
HTML / CSS — layout and styling, with a CSS-variable-based theme.

The quantum simulation is a direct statevector engine: each gate is applied as a unitary on the 2ⁿ amplitude array, and controlled gates are handled by a general control-mask over the base gate.

Roadmap
 Gate matrix inspector — hover a gate to see its unitary (2×2, or 4×4+ when controlled)
 Reduced density matrix per qubit, with purity — makes the Bloch sphere correct for entangled states (arrow shrinks inside the sphere as entanglement grows)
 Circuit presets — Bell, GHZ, phase kickback, Deutsch–Jozsa, QFT, and more, each with a short explanation
 Smooth step-playback animation with a progress indicator on the circuit
 Additional views and tools behind the top menu (multi-page expansion)

 License


Built by seolwon64.