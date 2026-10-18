// 상태별 대비 전수 측정 — 장면마다 보이는 클릭 가능 요소 전부를 상태 다섯으로 재는 수동 도구(Playwright MCP 로 돌린다).
//
// 무엇을 재나
//   요소: 아래 SEL 에 걸리고 보이는 것 전부(버튼·링크·select·input·Hide 토글 라벨·팔레트 칩·배치 게이트·제어점·탭).
//   상태: 기본 / hover / active 단독 / 누름(hover+active) / focus(focus+focus-visible) — CDP `CSS.forcePseudoState` 로 건다.
//   active 단독도 정식 상태다(키보드 Space·터치는 hover 없이 :active 만 건다 — design-spec "인터랙티브 상태").
//   칸 하나 = `배경/글자 대비 [scale(s)] [ol 링색]` — 배경·글자는 화면에 보이는 합성색(아래), 대비는 WCAG 대비비.
//
// 쓰는 법
//   1) 정적 서버: `python -m http.server 8765 --bind 127.0.0.1`(리포 루트). 두 판을 비교하려면 옛 판을 스크래치패드에
//      풀어(`git archive <커밋> | tar -x -C <폴더>`) 다른 포트로 하나 더 띄우고 BASES 에 더한다 — 첫 항목이 기준이다.
//   2) Playwright MCP(`--isolated`)의 browser_run_code_unsafe 에 filename "scripts/contrast-survey.js" 를 넘긴다.
//   이 파일은 **함수 식 하나**다. MCP 가 파일 글자를 `(…)(page)` 로 감싸 돌리므로 `export` 를 쓰면 문법 오류가 된다.
//   그래도 ESM 으로 파싱되는 글이라(식 문장) Stop 훅의 `node --check` 를 통과한다. import 를 쓰지 않는다.
//
// 장면(매번 다시 로드하고 localStorage 를 지운다 — design-spec "측정 규칙")
//   A 기본 + 코드 밴드 펼침 · B 측정 회로 + Inspect 켬 + Qubits 막대 · B' 측정 회로 + Q-sphere · C 게이트 메뉴(H) · D 예제 메뉴 ·
//   E 제어 고르기 팝오버(첫 후보가 골라진 채) · E2 같은 팝오버에서 고른 것을 해제(Apply 가 네이티브 disabled) ·
//   F 게이트 정보(rccx 분해 — Apply expansion 알약) · G 6큐비트 H⊗6 + Run(Reset·Show all 이 이때만 보인다)
//
// 출력(마크다운 글)
//   · 요약: 요소 수 × 상태 수, 장면별 요소 수.
//   · 판마다 "비활성 반응": 비활성 요소(`disabled`·`.is-disabled`·`aria-disabled="true"`)의 hover·active·누름 칸이 그 요소의
//     기본 칸과 다르면 한 줄. 사용 불가 칩(`data-ready="false"` — 드래그만 막고 비활성 표시는 없다)은 따로 센다.
//   · BASES 가 둘 이상이면 기준 판과 칸 단위로 다른 곳만 표로.
//
// 합성·opacity
//   반투명 배경이 많아 계산값을 그대로 쓰면 틀린다. 조상 배경을 위에서부터 알파 합성하고(맨 아래 흰색), 그 위에 요소 배경,
//   요소 배경 위에 글자색을 합성한다. 그다음 요소와 조상의 opacity 를 곱해 그 값으로 뒤 배경과 섞는다(그룹 opacity 의
//   근사 — 비활성의 opacity 0.45 가 여기서 들어간다). 링 색은 뒤 배경 위에 합성한다.
//   측정 중에는 전환·애니메이션을 끄는 스타일을 넣는다(전환 중간값을 읽지 않게). HTTP 캐시는 CDP 로 끈다.
//
// 한계
//   · 강제 상태는 실제 포인터와 다를 수 있다 — 의심되면 mouse.move·mouse.down 으로 따로 잰다(Chrome 은 네이티브 disabled
//     버튼에도 실제 누름에 :active 를 건다 — 실측).
//   · 글자와 아이콘을 가르지 않는다(둘 다 글자색 대 배경). 제어점처럼 글자 없는 도형은 대비가 1.00 으로 나온다 — 채움 대 뒤 배경은 따로 잰다.
async (page) => {
  const BASES = { 지금: 'http://127.0.0.1:8765/index.html' };
  const SEL = 'button, a[href], select, input, label.prob-hide-toggle, label.state-hide-toggle, .gate-chip, .placed-gate, .ctrl-dot, [role="tab"], [tabindex="0"]';
  const STATES = [['기본', []], ['hover', ['hover']], ['active', ['active']], ['누름', ['hover', 'active']], ['focus', ['focus', 'focus-visible']]];

  await page.setViewportSize({ width: 1536, height: 740 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // 페이지 안에서 도는 부분 — 합성색·대비 계산과 요소 목록
  const SETUP = (sel) => {
    window.__m = (el) => {
      const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const over = (t, b) => { const a = t[3]; return [0, 1, 2].map((i) => t[i] * a + b[i] * (1 - a)).concat(1); };
      const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
      let behind = [255, 255, 255, 1];
      for (let i = 0; i < chain.length - 1; i++) behind = over(parse(getComputedStyle(chain[i]).backgroundColor), behind);
      const cs = getComputedStyle(el);
      let op = 1; for (const n of chain) op *= Number(getComputedStyle(n).opacity);
      const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ownBg = over(parse(cs.backgroundColor), behind);
      const fg = over(parse(cs.color), ownBg);
      const bgF = [0, 1, 2].map((i) => ownBg[i] * op + behind[i] * (1 - op));
      const fgF = [0, 1, 2].map((i) => fg[i] * op + behind[i] * (1 - op));
      const x = lum(fgF), y = lum(bgF);
      const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const tf = cs.transform === 'none' ? '' : ' ' + cs.transform.replace(/matrix\(([\d.]+), 0, 0, ([\d.]+), 0, 0\)/, 'scale($1)');
      const ol = cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? '' : ` ol ${hex(over(parse(cs.outlineColor), behind))}`;
      return `${hex(bgF)}/${hex(fgF)} ${((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)}${tf}${ol}`;
    };
    window.__list = () => {
      const seen = new Map();
      return [...new Set(document.querySelectorAll(sel))]
        .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
        .map((e) => {
          const sig = e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => c !== 'hidden').slice(0, 3).join('.')}`;
          const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 22);
          const k = `${sig}|${name}`; const n = (seen.get(k) ?? 0) + 1; seen.set(k, n);
          const id = (window.__mid = (window.__mid || 0) + 1); e.setAttribute('data-mid', id);
          const disabled = e.disabled === true || e.classList.contains('is-disabled') || e.getAttribute('aria-disabled') === 'true';
          return { id, key: `${k}${n > 1 ? ' #' + n : ''}`, disabled, unready: e.dataset.ready === 'false' };
        });
    };
  };

  async function load(base, qasm) {
    await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(700);
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    await page.evaluate(SETUP, SEL);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    if (qasm) { await page.click('#code-entry'); await page.fill('#code-text', qasm); await page.click('#code-apply'); await page.waitForTimeout(500); }
    await page.mouse.move(1, 1);
  }

  async function survey(scene, out) {
    await page.mouse.move(1, 1); // 실제 포인터가 요소 위에 있으면 "기본" 칸이 hover 로 오염된다
    const items = await page.evaluate(() => window.__list());
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    for (const it of items) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-mid="${it.id}"]` });
      const cells = {};
      for (const [k, st] of STATES) {
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: st });
        cells[k] = await page.evaluate((id) => window.__m(document.querySelector(`[data-mid="${id}"]`)), it.id);
      }
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      out[`${scene}|${it.key}`] = { cells, disabled: it.disabled, unready: it.unready };
    }
  }

  const Q2M = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q[0] -> c[0];\n';
  const Q3H = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\n';
  const Q3R = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nrccx q[0],q[1],q[2];\n'; // ccx 는 원시 게이트라 분해가 없다
  const Q6H = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[6];\ncreg c[6];\n' + [0, 1, 2, 3, 4, 5].map((i) => `h q[${i}];`).join('\n') + '\n';

  const res = {};
  for (const [side, base] of Object.entries(BASES)) {
    const out = {};
    await load(base, null);
    await page.click('#code-entry'); await page.waitForTimeout(300);
    await survey('A 기본+코드 밴드', out);
    await load(base, Q2M);
    await page.click('#inspect-btn'); await page.waitForTimeout(400);
    await page.click('.segmented-btn[data-view="qubits"]'); await page.waitForTimeout(300);
    await survey('B Inspect·Qubits', out);
    await load(base, Q2M);
    // 글자 locator(`>> text=`)는 자손을 찾아 버튼 자신의 글자에 걸리지 않는다 — 예전 판은 이 클릭이 조용히 빗나가
    // B' 가 Bloch 그대로였다. 속성으로 고르고, 바뀌었는지 확인한다.
    await page.click('.segmented-btn[data-view="qsphere"]'); await page.waitForTimeout(400);
    if (!(await page.locator('.segmented-btn[data-view="qsphere"].active').count())) throw new Error("B': Q-sphere 로 바뀌지 않았다");
    await survey("B' Q-sphere", out);
    await load(base, Q2M);
    await page.click('.grid-cell[data-col="0"][data-qubit="0"] .placed-gate'); await page.waitForTimeout(300);
    await survey('C 게이트 메뉴', out);
    await load(base, null);
    await page.click('#presets-btn'); await page.waitForTimeout(300);
    await survey('D 예제 메뉴', out);
    await load(base, Q3H);
    await page.click('.grid-cell[data-col="0"][data-qubit="0"] .placed-gate'); await page.waitForTimeout(300);
    await page.click('.gate-menu-item[aria-label="Add control"]'); await page.waitForTimeout(300);
    await survey('E 제어 팝오버(1개 고름)', out);
    await page.click('#place-popover .qpick-btn.selected'); await page.waitForTimeout(200);
    await survey('E2 제어 팝오버(고른 것 없음)', out);
    await load(base, Q3R);
    await page.click('.grid-cell[data-col="0"][data-qubit="2"]'); await page.waitForTimeout(300);
    await page.click('.gate-menu-item[aria-label="Expand definition"]'); await page.waitForTimeout(400);
    await survey('F 게이트 정보', out);
    await load(base, Q6H);
    await page.click('#run-btn'); await page.waitForTimeout(600);
    await survey('G 6큐비트+Run', out);
    res[side] = out;
  }

  const sides = Object.keys(res);
  const ref = res[sides[0]];
  const keys = Object.keys(ref);
  const perScene = {};
  for (const k of keys) { const s = k.split('|')[0]; perScene[s] = (perScene[s] ?? 0) + 1; }
  const row = (k) => k.replace(/\|/g, ' · ');
  const lines = [`요소 ${keys.length}개 × 상태 ${STATES.length} = ${keys.length * STATES.length}칸 (장면별: ${Object.entries(perScene).map(([s, n]) => `${s} ${n}`).join(' · ')})`];

  // 비활성 반응 — hover·active·누름이 기본과 다른 칸
  for (const side of sides) {
    const r = res[side];
    const react = (pick) => Object.entries(r).filter(([, v]) => pick(v)).flatMap(([k, v]) =>
      ['hover', 'active', '누름'].filter((s) => v.cells[s] !== v.cells['기본']).map((s) => `| ${row(k)} | ${s} | ${v.cells['기본']} | ${v.cells[s]} |`));
    const dis = Object.values(r).filter((v) => v.disabled).length;
    const disRows = react((v) => v.disabled);
    const unr = Object.values(r).filter((v) => v.unready).length;
    const unrRows = react((v) => v.unready && !v.disabled);
    lines.push('', `## ${side} — 비활성 반응: 비활성 요소 ${dis}개 중 ${disRows.length}칸`);
    if (disRows.length) lines.push('| 장면 · 요소 | 상태 | 기본 | 그 상태 |', '|---|---|---|---|', ...disRows);
    lines.push('', `## ${side} — 사용 불가 칩(data-ready="false", 비활성 표시 없음) ${unr}개 중 반응 ${unrRows.length}칸`);
    if (unrRows.length) lines.push('| 장면 · 요소 | 상태 | 기본 | 그 상태 |', '|---|---|---|---|', ...unrRows);
  }

  // 판 비교 — 기준 판(첫 항목)과 칸 단위로 다른 곳
  for (const side of sides.slice(1)) {
    const r = res[side];
    const only = [...keys.filter((k) => !(k in r)), ...Object.keys(r).filter((k) => !(k in ref))];
    const changed = keys.filter((k) => k in r).flatMap((k) => STATES.map(([s]) => s)
      .filter((s) => ref[k].cells[s] !== r[k].cells[s])
      .map((s) => `| ${row(k)} | ${s} | ${ref[k].disabled ? '비활성' : ref[k].unready ? '사용 불가' : '**활성**'} | ${ref[k].cells[s]} | ${r[k].cells[s]} |`));
    lines.push('', `## ${sides[0]} → ${side}: 바뀐 칸 ${changed.length}${only.length ? ` · 한쪽에만 있는 요소 ${only.length} — ${only.join(', ')}` : ''}`);
    if (changed.length) lines.push(`| 장면 · 요소 | 상태 | 요소 상태 | ${sides[0]} | ${side} |`, '|---|---|---|---|---|', ...changed);
  }
  return lines.join('\n');
}
