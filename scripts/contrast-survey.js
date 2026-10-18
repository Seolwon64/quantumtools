// 상태별 대비 전수 측정 — 장면마다 보이는 클릭 가능 요소와 정적 글자 전부를 재는 수동 도구(Playwright MCP 로 돌린다).
//
// 무엇을 재나
//   클릭 요소: 아래 SEL 에 걸리고 보이는 것 전부(버튼·링크·select·input·Hide 토글 라벨·팔레트 칩·배치 게이트·제어점·탭).
//     상태 다섯: 기본 / hover / active 단독 / 누름(hover+active) / focus(focus+focus-visible) — CDP `CSS.forcePseudoState`.
//     active 단독도 정식 상태다(키보드 Space·터치는 hover 없이 :active 만 건다 — design-spec "인터랙티브 상태").
//   정적 글자: 자기 글자(텍스트 노드)나 SVG `<text>` 를 가진 요소 중 클릭 요소 밖의 것 — 기본 상태 한 칸만 잰다. 패널 제목·축·
//     주석처럼 상태가 없는 글자의 변화가 표에 나오게 하려고 넣었다(흐린 글자 작업 때 이것 없이는 "의도 밖 변화 없음" 을 못 봤다).
//   칸 하나 = `배경/글자 대비 [scale(s)] [ol 링색] [bd 경계색 대비]` — 배경·글자는 화면에 보이는 합성색(아래), 대비는 WCAG 대비비.
//     입력 요소(input·select·textarea)는 `bd` 에 **경계 대 바깥 면 대비**를 붙인다 — 자기 테두리, 없으면 감싸개 `.code-editor` 의
//     테두리. 기준은 바깥 면(design-spec "인터랙티브 상태" 의 입력란 경계)이고, 필드 안쪽 대비는 따로 재야 한다.
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
//   F 게이트 정보(rccx 분해 — Apply expansion 알약) · G 6큐비트 H⊗6 + Run(Reset·Show all 이 이때만 보인다) ·
//   H 텔레포테이션 예제(궤적 — 확률 패널의 Inspect 주석·밀도행렬의 궤적 주석이 이때만 보인다)
//
// 출력(마크다운 글)
//   · 요약: 요소 수(클릭·정적 글자), 장면별 요소 수.
//   · 판마다 "기준 미달": 글자 4.5(큰 글자 — 24px, 굵게 18.66px — 는 3)·아이콘만 있는 버튼 3 에 못 미치는 칸. 비활성은 WCAG 예외라
//     빼고, 칩·배치 게이트·제어점은 test/colors.test.mjs 가 지키므로 뺀다.
//   · 판마다 "비활성 반응": 비활성 요소(`disabled`·`.is-disabled`·`aria-disabled="true"`)의 hover·active·누름 칸이 그 요소의
//     기본 칸과 다르면 한 줄. 사용 불가 칩(`data-ready="false"` — 드래그만 막고 비활성 표시는 없다)은 따로 센다.
//   · BASES 가 둘 이상이면 기준 판과 칸 단위로 다른 곳만 표로.
//
// 합성·opacity
//   반투명 배경이 많아 계산값을 그대로 쓰면 틀린다. 조상 배경을 위에서부터 알파 합성하고(맨 아래 흰색), 그 위에 요소 배경,
//   요소 배경 위에 글자색을 합성한다. 그다음 요소와 조상의 opacity 를 곱해 그 값으로 뒤 배경과 섞는다(그룹 opacity 의
//   근사 — 비활성의 opacity 0.45 가 여기서 들어간다). 링·경계 색은 뒤 배경 위에 합성한다. SVG `<text>` 는 `fill` 을 글자색으로 본다.
//   측정 중에는 전환·애니메이션을 끄는 스타일을 넣는다(전환 중간값을 읽지 않게). HTTP 캐시는 CDP 로 끈다.
//
// 난수(고정 시드 — 주입)
//   궤적(H 장면의 상태 항)과 Run 표본(G)이 로드마다 달라, 같은 빌드를 두 번 재도 칸이 바뀌었다(흐린 글자 작업 때 "한쪽에만
//   있는 요소 4" 가 텔레포테이션 상태 항이었다). 앱에는 시드를 넣는 입구가 없다 — 공유 링크·저장 상태에 시드가 없고
//   (trajectory.js `randomSeed`: 새로 열면 다른 궤적이 맞다), 시드 인자는 테스트용 함수 인자뿐이다. 앱이 난수를 얻는 곳은
//   전부 `Math.random` 이라, 로드마다 앱보다 먼저(CDP `Page.addScriptToEvaluateOnNewDocument`) 그것을 바꾼다. 앱 코드는 그대로다.
//   **앱 모듈(`/js/*.js`)이 부른 것만** 고정 수열(mulberry32 — `makeRng` 와 같은 식)을 받고 나머지는 원래 것을 받는다 —
//   Three.js `generateUUID` 도 `Math.random` 을 부른다(텔레포테이션 한 판에 앱 1025번·Three.js 896번 — 실측). 지금 장면은
//   재생이 없어 896 이 일정했지만, 꼬리 메시는 애니메이션 프레임마다 새로 만들어져(scene.js `rebuildTrailMesh`) 재생이 섞이면
//   그 수가 프레임 수를 따른다 — 수열 하나를 같이 쓰면 그만큼 앱 몫이 밀린다. 측정이 끝나면(실패해도) 스크립트를 지운다.
//   대조(실측): 주입 없이 여섯 번 로드하면 상태식이 4가지, 고정 시드로는 1가지였다.
//
// 한계
//   · 강제 상태는 실제 포인터와 다를 수 있다 — 의심되면 mouse.move·mouse.down 으로 따로 잰다(Chrome 은 네이티브 disabled
//     버튼에도 실제 누름에 :active 를 건다 — 실측).
//   · 캔버스(3D 뷰 라벨)는 계산값이 없어 여기서 못 잰다 — 스크린샷 픽셀로 따로 잰다. 네이티브 체크박스·슬라이더도 뺀다.
//   · 제어점처럼 글자 없는 도형은 대비가 1.00 으로 나온다(기준 미달 표에서는 뺀다) — 채움 대 뒤 배경은 따로 잰다.
async (page) => {
  const BASES = { 지금: 'http://127.0.0.1:8765/index.html' };
  // textarea 가 처음엔 빠져 코드 편집기의 경계가 표에 안 나왔다(흐린 글자 작업 때 실측)
  const SEL = 'button, a[href], select, input, textarea, label.prob-hide-toggle, label.state-hide-toggle, .gate-chip, .placed-gate, .ctrl-dot, [role="tab"], [tabindex="0"]';
  const STATES = [['기본', []], ['hover', ['hover']], ['active', ['active']], ['누름', ['hover', 'active']], ['focus', ['focus', 'focus-visible']]];

  await page.setViewportSize({ width: 1536, height: 740 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // 페이지 안에서 앱보다 먼저 도는 부분 — 머리 주석 "난수". 호출 줄([2])이 앱 모듈일 때만 고정 수열을 준다.
  const SEED = 0x5eed;
  const seedRandom = (seed) => {
    const native = Math.random;
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__seed = { seed, calls: 0 };
    Math.random = function random() {
      if (!/\/js\/[\w-]+\.js/.test(new Error().stack.split('\n')[2] ?? '')) return native();
      window.__seed.calls++;
      return next();
    };
  };
  // 이 세션에서 Page 를 켜지 않으면 스크립트가 등록만 되고 돌지 않는다(실측 — 오류도 없이 로드마다 원래 Math.random 이었다)
  await cdp.send('Page.enable');
  const { identifier: seedScript } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${seedRandom})(${SEED})` });

  // 페이지 안에서 도는 부분 — 합성색·대비 계산과 요소 목록
  const SETUP = (sel) => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (t, b) => { const a = t[3]; return [0, 1, 2].map((i) => t[i] * a + b[i] * (1 - a)).concat(1); };
    const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const behindOf = (el) => { const chain = []; for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n); let b = [255, 255, 255, 1]; for (const n of chain) { if (n instanceof SVGElement && n.tagName !== 'svg') continue; b = over(parse(getComputedStyle(n).backgroundColor), b); } return b; };
    const FIELD = 'input:not([type="checkbox"]):not([type="range"]), select, textarea';
    window.__m = (el) => {
      // 목록을 만든 뒤 렌더가 그 요소를 갈아 끼우면(차트·상태 줄) 여기서 null 이 온다 — 멈추지 않고 표시만 남긴다
      if (!el || !el.isConnected) return '사라짐';
      const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
      const behind = behindOf(el);
      const cs = getComputedStyle(el);
      let op = 1; for (const n of chain) op *= Number(getComputedStyle(n).opacity);
      // 목록을 만들 때는 보였는데 재는 사이에 숨은 것(제때 사라지는 토스트 — 전환을 꺼서 바로 opacity 0) — 대비를 내지 않는다
      if (op <= 0.05) return '안 보임';
      const ownBg = el instanceof SVGElement ? behind : over(parse(cs.backgroundColor), behind);
      const fg = over(parse(el instanceof SVGTextElement ? cs.fill : cs.color), ownBg);
      const bgF = [0, 1, 2].map((i) => ownBg[i] * op + behind[i] * (1 - op));
      const fgF = [0, 1, 2].map((i) => fg[i] * op + behind[i] * (1 - op));
      const tf = cs.transform === 'none' ? '' : ' ' + cs.transform.replace(/matrix\(([\d.]+), 0, 0, ([\d.]+), 0, 0\)/, 'scale($1)');
      const ol = cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? '' : ` ol ${hex(over(parse(cs.outlineColor), behind))}`;
      let bd = '';
      if (el.matches(FIELD)) {
        const host = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? el : el.closest('.code-editor');
        if (!host) bd = ' bd 없음';
        else { const out = behindOf(host); const bc = over(parse(getComputedStyle(host).borderTopColor), out); bd = ` bd ${hex(bc)} ${ratio(bc, out).toFixed(2)}`; }
      }
      return `${hex(bgF)}/${hex(fgF)} ${ratio(fgF, bgF).toFixed(2)}${tf}${ol}${bd}`;
    };
    /** 기준: 글자 4.5(큰 글자 3) · 아이콘만 3 · 0 은 기준 미달 표에서 뺀다(칩·게이트·제어점·네이티브 체크박스·슬라이더). */
    const need = (el) => {
      if (el.matches('.gate-chip, .placed-gate, .ctrl-dot, input[type="checkbox"], input[type="range"]') || el.closest('.gate-chip, .placed-gate')) return 0;
      const clone = el.cloneNode(true); clone.querySelectorAll('svg').forEach((s) => s.remove());
      const text = el.tagName === 'SELECT' || el.matches('input, textarea') || (el instanceof SVGTextElement) || clone.textContent.trim() !== '';
      if (!text) return el.querySelector('svg') ? 3 : 0;
      const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize), w = Number(cs.fontWeight);
      return px >= 24 || (px >= 18.66 && w >= 700) ? 3 : 4.5;
    };
    // opacity 가 사실상 0 인 요소(사라진 토스트 등)는 보이지 않는다 — 넣으면 대비 1.00 짜리 거짓 미달이 된다(실측)
    const visible = (e) => {
      if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return false;
      let op = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      return op > 0.05;
    };
    // 정적 글자에서 빼는 것은 **컨트롤 안의 글자**뿐이다. 스크롤 감싸개(`[tabindex="0"]` — 게이트 행렬 .mx-scroll 등)는 SEL 에
    // 있지만 그 안의 글자는 컨트롤 글자가 아니다 — 처음엔 SEL 전체로 뺐다가 행렬 칸이 하나도 안 재졌다(실측).
    const CONTROL = 'button, a[href], select, input, textarea, label.prob-hide-toggle, label.state-hide-toggle, .gate-chip, .placed-gate, .ctrl-dot, [role="tab"]';
    window.__list = () => {
      const seen = new Map();
      const entry = (e, kind) => {
        const sig = e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => c !== 'hidden').slice(0, 3).join('.')}`;
        const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 22);
        const k = `${kind === '글자' ? '글자 ' : ''}${sig}|${name}`; const n = (seen.get(k) ?? 0) + 1; seen.set(k, n);
        const id = (window.__mid = (window.__mid || 0) + 1); e.setAttribute('data-mid', id);
        const ctl = e.closest('button, a[href], label, select, [role="tab"]');
        const disabled = [e, ctl].some((x) => x && (x.disabled === true || x.classList.contains('is-disabled') || x.getAttribute('aria-disabled') === 'true'));
        return { id, key: `${k}${n > 1 ? ' #' + n : ''}`, kind, disabled, unready: e.dataset.ready === 'false', need: need(e) };
      };
      const ctl = [...new Set(document.querySelectorAll(sel))].filter(visible).map((e) => entry(e, '클릭'));
      const text = [...document.querySelectorAll('body *')].filter((e) => !e.matches(sel) && !e.closest(CONTROL) && !e.closest('canvas') && visible(e)
        && (e instanceof SVGTextElement || [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim() !== '')))
        .map((e) => entry(e, '글자'));
      return [...ctl, ...text];
    };
  };

  async function load(base, qasm) {
    await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(700);
    // 주입이 빠지면 조용히 Math.random 으로 돌아 판끼리 칸이 다시 흔들린다 — 로드마다 확인한다
    if ((await page.evaluate(() => window.__seed?.seed)) !== SEED) throw new Error('고정 시드 스크립트가 이 로드에 들어가지 않았다');
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
      const cells = {};
      if (it.kind === '글자') {
        cells['기본'] = await page.evaluate((id) => window.__m(document.querySelector(`[data-mid="${id}"]`)), it.id);
      } else {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-mid="${it.id}"]` });
        for (const [k, st] of STATES) {
          await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: st });
          cells[k] = await page.evaluate((id) => window.__m(document.querySelector(`[data-mid="${id}"]`)), it.id);
        }
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      }
      out[`${scene}|${it.key}`] = { cells, kind: it.kind, disabled: it.disabled, unready: it.unready, need: it.need };
    }
  }

  const Q2M = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q[0] -> c[0];\n';
  const Q3H = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\n';
  const Q3R = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nrccx q[0],q[1],q[2];\n'; // ccx 는 원시 게이트라 분해가 없다
  const Q6H = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[6];\ncreg c[6];\n' + [0, 1, 2, 3, 4, 5].map((i) => `h q[${i}];`).join('\n') + '\n';

  const res = {};
  try {
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
      // 표본은 덩어리마다 setTimeout 으로 양보하며 뽑는다 — 고정 대기 대신 끝(버튼이 다시 켜짐)을 기다린다
      await page.click('#run-btn');
      await page.waitForFunction(() => !document.querySelector('#run-btn').disabled && !document.querySelector('#reset-shots-btn').classList.contains('hidden'));
      await survey('G 6큐비트+Run', out);
      await load(base, null);
      await page.click('#presets-btn'); await page.waitForTimeout(300);
      await page.click('.preset-item:has-text("teleportation")'); await page.waitForTimeout(800);
      if (!(await page.locator('.prob-inspect-note').count())) throw new Error('H: 궤적 주석이 보이지 않는다 — 텔레포테이션이 궤적으로 돌지 않았다');
      // 궤적 시드를 고정 수열에서 받았는지 — 호출 줄 판별이 빗나가면(모듈 경로가 바뀌면) 0 이다
      if (!(await page.evaluate(() => window.__seed.calls))) throw new Error('H: 앱이 고정 수열을 한 번도 받지 않았다 — 호출 줄 판별을 확인한다');
      await survey('H 텔레포테이션', out);
      res[side] = out;
    }
  } finally {
    // 같은 브라우저로 이어서 여는 페이지에 남지 않게
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScript });
  }

  const sides = Object.keys(res);
  const ref = res[sides[0]];
  const keys = Object.keys(ref);
  const perScene = {};
  for (const k of keys) { const s = k.split('|')[0]; perScene[s] = (perScene[s] ?? 0) + 1; }
  const row = (k) => k.replace(/\|/g, ' · ');
  const nCtl = keys.filter((k) => ref[k].kind === '클릭').length;
  const lines = [`요소 ${keys.length}개(클릭 ${nCtl} × 상태 ${STATES.length} · 정적 글자 ${keys.length - nCtl} × 기본) (장면별: ${Object.entries(perScene).map(([s, n]) => `${s} ${n}`).join(' · ')})`];
  const ratioOf = (cell) => Number(cell.match(/^#\w+\/#\w+ ([\d.]+)/)?.[1]);

  for (const side of sides) {
    const r = res[side];
    // 기준 미달 — 비활성은 예외, need 0 은 뺀다
    const fails = Object.entries(r).filter(([, v]) => v.need > 0 && !v.disabled).flatMap(([k, v]) =>
      Object.entries(v.cells).filter(([s, c]) => s !== 'focus' && ratioOf(c) < v.need - 0.005).map(([s, c]) => `| ${row(k)} | ${s} | ${v.need} | ${c} |`));
    lines.push('', `## ${side} — 기준 미달 ${fails.length}칸`);
    if (fails.length) lines.push('| 장면 · 요소 | 상태 | 기준 | 칸 |', '|---|---|---|---|', ...fails);
    // 비활성 반응 — hover·active·누름이 기본과 다른 칸
    const react = (pick) => Object.entries(r).filter(([, v]) => v.kind === '클릭' && pick(v)).flatMap(([k, v]) =>
      ['hover', 'active', '누름'].filter((s) => v.cells[s] !== v.cells['기본']).map((s) => `| ${row(k)} | ${s} | ${v.cells['기본']} | ${v.cells[s]} |`));
    const dis = Object.values(r).filter((v) => v.kind === '클릭' && v.disabled).length;
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
    const changed = keys.filter((k) => k in r).flatMap((k) => Object.keys(ref[k].cells)
      .filter((s) => ref[k].cells[s] !== r[k].cells[s])
      .map((s) => `| ${row(k)} | ${s} | ${ref[k].disabled ? '비활성' : ref[k].unready ? '사용 불가' : ref[k].kind === '글자' ? '정적 글자' : '**활성**'} | ${ref[k].cells[s]} | ${r[k].cells[s]} |`));
    lines.push('', `## ${sides[0]} → ${side}: 바뀐 칸 ${changed.length}${only.length ? ` · 한쪽에만 있는 요소 ${only.length} — ${only.join(', ')}` : ''}`);
    if (changed.length) lines.push(`| 장면 · 요소 | 상태 | 요소 상태 | ${sides[0]} | ${side} |`, '|---|---|---|---|---|', ...changed);
  }
  return lines.join('\n');
}
