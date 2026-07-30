// Three.js 기반 Bloch sphere 3D 렌더링, Slerp 상태 벡터 애니메이션, 시점 리셋.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { phaseToRgb } from "./phase.js";

// index.html의 html,body font-family와 반드시 일치시켜야 한다. 다르면 캔버스 텍스트가
// DOM 폰트와 다른 대체 글꼴로 그려져 ⟩, π 같은 글리프가 어긋나 보인다("깨져 보임").
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif';

const SPHERE_RADIUS = 1;
const WIREFRAME_COLOR = 0xb0b8c1;
const AXIS_COLOR = 0x98a2ad;
const LABEL_COLOR = "#4e5968";
const VECTOR_COLOR = 0x3182f6;
const TRAIL_COLOR = 0x3182f6; // 확률 막대그래프와 동일한 토스 블루
const TRAIL_RADIUS = 0.012;

// 초기/리셋 시점: 오른쪽 X축, 왼쪽 Y축, 위쪽 Z축이 보이는 구도.
const INITIAL_CAMERA_POS = new THREE.Vector3(2.6, 1.9, 2.6);

// bloch 좌표(x,y,z) -> three.js 좌표. three.js는 Y가 위쪽이므로
// bloch Z(위)를 three Y에, bloch Y를 three Z에 대응시킨다.
function blochToThree(v, out = new THREE.Vector3()) {
  return out.set(v.x, v.z, v.y);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function popcount(n) {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

// 위상 색은 phase.js의 **단일 정의**를 쓴다 — 색상환 범례와 노드가 같은 함수를 공유해야
// 범례가 거짓말을 하지 않는다. 여기서는 THREE.Color로 감싸기만 한다.
export function phaseToColor(phaseRad) {
  const { r, g, b } = phaseToRgb(phaseRad);
  return new THREE.Color(r, g, b);
}

// WebGL은 대부분의 브라우저/GPU에서 Line의 linewidth를 무시하고 항상 1px로 그리므로,
// 두께가 실제로 보이는 축을 그리려면 얇은 원기둥 메쉬를 써야 한다.
function makeAxisMesh(direction, length = 2.4, radius = 0.008) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: AXIS_COLOR,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (direction === "x") mesh.rotation.z = Math.PI / 2;
  if (direction === "z") mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function drawLabelCanvas(ctx, size, text) {
  ctx.clearRect(0, 0, size, size);
  const fontSize = text.length > 3 ? 34 : 56;
  ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
}

// updateLabelSprite(sprite, text)로 나중에 텍스트를 바꿀 수 있도록 canvas/ctx를 보관한다
// (Bloch <-> Q-sphere 모드 전환 시 극 라벨이 |0>/|1> <-> |00..0>/|11..1>로 바뀌어야 함).
function makeLabelSprite(text) {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  drawLabelCanvas(ctx, size, text);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.32, 0.32, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  sprite.userData.texture = texture;
  return sprite;
}

function updateLabelSprite(sprite, text) {
  const { ctx, texture } = sprite.userData;
  drawLabelCanvas(ctx, sprite.userData.canvas.width, text);
  texture.needsUpdate = true;
}

// Q-sphere 마커 라벨("|0000⟩ π" 등)처럼 가로로 긴 문자열 전용. 정사각 캔버스를
// 비균일 스케일로 늘리면 글자가 찌그러져 "깨진" 것처럼 보이므로, 캔버스 자체를
// 실제 필요한 가로세로 비율로 만들고 스프라이트는 그 비율 그대로 균일하게 스케일한다.
const WIDE_LABEL_W = 320;
const WIDE_LABEL_H = 120;
function makeWideLabelSprite(text, worldWidth = 0.6) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDE_LABEL_W;
  canvas.height = WIDE_LABEL_H;
  const ctx = canvas.getContext("2d");
  ctx.font = `600 44px ${FONT_STACK}`;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, WIDE_LABEL_W / 2, WIDE_LABEL_H / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * (WIDE_LABEL_H / WIDE_LABEL_W), 1);
  return sprite;
}

export function createBlochScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 6;

  // Q-sphere 유리 구에 하이라이트/음영/입체감을 주기 위한 조명 + 환경맵.
  // Bloch 모드의 와이어프레임/축/화살표/트레일은 전부 MeshBasicMaterial이라
  // 조명·환경맵 영향을 받지 않으므로 Bloch 뷰는 그대로 유지된다.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(3, 4, 2);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0xffffff, 0.6);
  rimLight.position.set(-3, 1.5, -2);
  scene.add(rimLight);

  // MeshPhysicalMaterial(유리 구)와 광택 노드가 주변을 반사하도록 부드러운 실내 환경맵을 굽는다.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  function resetView() {
    camera.position.copy(INITIAL_CAMERA_POS);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // Bloch 격자 (Bloch 모드 전용). 예전엔 wireframe 구 하나였는데 경도선이 빽빽해 화살표를
  // 가렸다. 경도선은 빼되, 위상 φ는 수평 각도로 읽는 값이라 **x·y·z 축 기준 대원은 남긴다**.
  const blochGridGroup = new THREE.Group();
  scene.add(blochGridGroup);

  const circlePoints = (radius, y, axis = "y") => {
    const pts = [];
    for (let s = 0; s <= 96; s++) {
      const a = (2 * Math.PI * s) / 96;
      const c = Math.cos(a) * radius;
      const d = Math.sin(a) * radius;
      if (axis === "y") pts.push(new THREE.Vector3(c, y, d));      // 수평(위도) 원
      else if (axis === "x") pts.push(new THREE.Vector3(0, c, d)); // yz 평면 대원
      else pts.push(new THREE.Vector3(c, d, 0));                   // xy 평면 대원
    }
    return pts;
  };
  const addLine = (pts, color, opacity) =>
    blochGridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    ));

  // 위도 사이 띠에 아주 옅은 음영 — 층이 구분되되 화살표·노드가 묻히지 않는 정도만.
  const N_LAT = 8; // 극각을 8등분 → 위도선 7개(적도 포함)
  const bandMat = new THREE.MeshBasicMaterial({
    color: WIREFRAME_COLOR, transparent: true, opacity: 0.045,
    side: THREE.DoubleSide, depthWrite: false,
  });
  for (let i = 0; i < N_LAT; i += 2) {
    const t0 = (Math.PI * i) / N_LAT;
    const t1 = (Math.PI * (i + 1)) / N_LAT;
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(SPHERE_RADIUS, 48, 8, 0, Math.PI * 2, t0, t1 - t0),
      bandMat
    );
    blochGridGroup.add(band);
  }

  // 위도선(가로 원). 적도만 더 진하고 굵게 그려 기준선임을 드러낸다.
  for (let i = 1; i < N_LAT; i++) {
    const t = (Math.PI * i) / N_LAT;
    const y = Math.cos(t) * SPHERE_RADIUS;
    const r = Math.sin(t) * SPHERE_RADIUS;
    const isEquator = i === N_LAT / 2;
    addLine(circlePoints(r, y), isEquator ? 0x6b7684 : WIREFRAME_COLOR, isEquator ? 0.55 : 0.24);
  }
  // 적도는 한 겹 더 얹어 굵어 보이게 한다(WebGL이 linewidth를 무시하므로).
  addLine(circlePoints(SPHERE_RADIUS * 0.999, 0), 0x6b7684, 0.45);

  // 축 기준 대원: xz(적도는 위에서 그림) 외에 xy·yz 평면 — x·y·z 방향을 읽는 기준.
  addLine(circlePoints(SPHERE_RADIUS, 0, "x"), WIREFRAME_COLOR, 0.3);
  addLine(circlePoints(SPHERE_RADIUS, 0, "z"), WIREFRAME_COLOR, 0.3);

  // X, Y, Z 축 (bloch X -> three X, bloch Y -> three Z, bloch Z -> three Y)
  const axisX = makeAxisMesh("x");
  const axisY = makeAxisMesh("y");
  const axisZ = makeAxisMesh("z");
  scene.add(axisX, axisY, axisZ);

  // 은은한 회색 라벨: 극(|0>, |1>)과 X, Y 축 양의 방향
  const zeroLabel = makeLabelSprite("|0⟩");
  zeroLabel.position.set(0, 1.42, 0);
  const oneLabel = makeLabelSprite("|1⟩");
  oneLabel.position.set(0, -1.42, 0);
  const xLabel = makeLabelSprite("x");
  xLabel.position.set(1.38, 0, 0);
  const yLabel = makeLabelSprite("y");
  yLabel.position.set(0, 0, 1.38);
  scene.add(zeroLabel, oneLabel, xLabel, yLabel);

  // 상태 벡터 화살표 (토스 블루)
  const initialDir = blochToThree({ x: 0, y: 0, z: 1 }).normalize();
  const arrow = new THREE.ArrowHelper(
    initialDir,
    new THREE.Vector3(0, 0, 0),
    SPHERE_RADIUS,
    VECTOR_COLOR,
    0.22,
    0.12
  );
  scene.add(arrow);

  // 혼합도 시각화: 반지름 |r|인 반투명 내부 구 + 완전혼합(|r|≈0)일 때 원점 점.
  const innerSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({ color: VECTOR_COLOR, transparent: true, opacity: 0.16, depthWrite: false })
  );
  innerSphere.visible = false;
  scene.add(innerSphere);
  const originDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 16, 12),
    new THREE.MeshBasicMaterial({ color: VECTOR_COLOR })
  );
  originDot.visible = false;
  scene.add(originDot);

  resetView();

  // 재생 중 벡터가 지나간 궤적 (토스 블루, 50% 불투명도). 재생을 다시 누르면 초기화된다.
  // Line은 대부분의 WebGL 환경에서 linewidth를 무시하므로(축과 동일한 문제),
  // 실제로 두껍게 보이도록 매 프레임 Tube 메쉬로 재생성한다.
  let trailPoints = [];
  let trailMesh = null;
  let sceneMode = "bloch"; // setMode()가 갱신. rebuildTrailMesh가 새 메쉬를 만들 때 참조.
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    opacity: 0.5,
  });

  function rebuildTrailMesh() {
    if (trailMesh) {
      scene.remove(trailMesh);
      trailMesh.geometry.dispose();
      trailMesh = null;
    }
    if (trailPoints.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(trailPoints);
    const tubularSegments = Math.max(8, trailPoints.length * 2);
    const geo = new THREE.TubeGeometry(curve, tubularSegments, TRAIL_RADIUS, 6, false);
    trailMesh = new THREE.Mesh(geo, trailMaterial);
    trailMesh.visible = sceneMode === "bloch";
    scene.add(trailMesh);
  }

  function clearTrail() {
    trailPoints = [];
    rebuildTrailMesh();
  }

  // tip: 화살표 끝점 위치 (방향 x 길이, three.js 좌표).
  // 벡터가 정지한 스텝(no-op, 다른 큐비트 게이트)에서는 같은 좌표가 매 프레임 쌓이는데,
  // CatmullRomCurve3가 중복 점에서 0-접선 -> TubeGeometry NaN을 만들어 궤적이 깜빡이므로
  // 마지막 점과 사실상 같은 위치면 추가하지 않는다.
  const TRAIL_MIN_DIST_SQ = 1e-6;

  function pushTrailPoint(tip) {
    const point = tip.clone().multiplyScalar(SPHERE_RADIUS);
    if (point.lengthSq() < TRAIL_MIN_DIST_SQ) return; // 화살표 숨김(길이~0) 구간
    const last = trailPoints[trailPoints.length - 1];
    if (last && last.distanceToSquared(point) < TRAIL_MIN_DIST_SQ) return;
    trailPoints.push(point);
    rebuildTrailMesh();
  }

  const R_MIXED = 0.02; // |r|이 이보다 작으면 완전 혼합 → 화살표 대신 원점 점
  const R_PURE = 0.999; // |r|이 이보다 크면 순수 → 내부 구 생략(표면 도달)
  let curMixed = false;
  let curInner = false;

  // 블로흐 요소(화살표/원점점/내부구) 표시는 현재 |r| 상태와 씬 모드에 함께 좌우된다.
  function applyBlochVisibility() {
    const isBloch = sceneMode === "bloch";
    arrow.visible = isBloch && !curMixed;
    originDot.visible = isBloch && curMixed;
    innerSphere.visible = isBloch && curInner;
  }

  // 벡터 길이(|r|) 반영: 축약상태가 혼합될수록 화살표가 짧아지고 반지름 |r| 내부 구가 드러난다.
  function applyArrow(dir, length) {
    const len = Math.max(length, 0);
    curMixed = len < R_MIXED;
    curInner = !curMixed && len < R_PURE;
    if (!curMixed) {
      arrow.setDirection(dir);
      arrow.setLength(len * SPHERE_RADIUS, Math.min(0.22, len * 0.5), Math.min(0.12, len * 0.3));
    }
    innerSphere.scale.setScalar(Math.max(len, 1e-3) * SPHERE_RADIUS);
    applyBlochVisibility();
  }

  function safeDirection(v, fallback) {
    return v.lengthSq() < 1e-12 ? fallback.clone() : v.clone().normalize();
  }

  const UP = new THREE.Vector3(0, 1, 0);

  function setVectorInstant(bloch) {
    const v = blochToThree(bloch);
    applyArrow(safeDirection(v, UP), v.length());
  }

  function animateVectorTo(fromBloch, toBloch, duration = 500) {
    return new Promise((resolve) => {
      const fromRaw = blochToThree(fromBloch);
      const toRaw = blochToThree(toBloch);
      const fromLen = fromRaw.length();
      const toLen = toRaw.length();
      const fromV = safeDirection(fromRaw, UP);
      const toV = safeDirection(toRaw, fromV);
      const qTotal = new THREE.Quaternion().setFromUnitVectors(fromV, toV);
      const identity = new THREE.Quaternion();
      const start = performance.now();

      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeOutCubic(t);
        const qStep = identity.clone().slerp(qTotal, eased);
        const dir = fromV.clone().applyQuaternion(qStep).normalize();
        const len = fromLen + (toLen - fromLen) * eased;
        applyArrow(dir, len);
        pushTrailPoint(dir.clone().multiplyScalar(Math.max(len, 0.001)));
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // renderLoop 정의만 하고 호출은 Q-sphere 요소(qsphereBgGroup, silhouette) 생성 후에 한다
  // (const TDZ 때문에 먼저 호출하면 "Cannot access before initialization" 발생).
  function renderLoop() {
    controls.update();
    // Q-sphere 외곽 실루엣 링을 항상 카메라를 향하게(billboard) 회전시켜 구 윤곽처럼 보이게 한다.
    if (qsphereBgGroup.visible) silhouette.quaternion.copy(camera.quaternion);
    // [5] 노드 hover: mousemove마다 레이캐스트하면 비싸므로 좌표만 저장하고 **프레임당 1회**만 검사.
    if (hoverDirty) { hoverDirty = false; updateHover(); }
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }

  // ---------- Q-sphere (IBM 스타일 전체 상태 시각화) ----------
  // Bloch sphere는 얽힌 상태를 표현할 수 없으므로, 얽힌 회로에서는 대신 이 뷰로
  // 전환해 전체 2^n 계산기저를 위도(해밍 가중치)·경도(같은 가중치 내 균등 분산)로
  // 배치하고, 크기는 확률, 색상은 위상으로 표현한다.
  const qsphereBgGroup = new THREE.Group();
  qsphereBgGroup.visible = false;
  scene.add(qsphereBgGroup);

  // 유리 같은 반투명 구 (MeshPhysicalMaterial + transmission). 환경맵을 반사해
  // 표면에 하이라이트가 맺히고 속이 비쳐 입체적인 유리 구슬처럼 보인다.
  const qsphereFillMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf0f7,
    metalness: 0,
    roughness: 0.08,
    transmission: 1.0,
    thickness: 1.4,
    ior: 1.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 1.0,
    envMapIntensity: 1.1,
    depthWrite: false,
  });
  const qsphereFillMesh = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_RADIUS, 64, 48), qsphereFillMat);
  qsphereBgGroup.add(qsphereFillMesh);

  // --- 정적 장식(큐비트 수와 무관, 한 번만 생성) ---
  // 극-극 수직 중심축
  const poleAxis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -SPHERE_RADIUS, 0),
      new THREE.Vector3(0, SPHERE_RADIUS, 0),
    ]),
    new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.45 })
  );
  qsphereBgGroup.add(poleAxis);

  // 경도(longitude) 메리디안 — globe처럼 구를 감싸는 세로 반원들
  const meridianMat = new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.22 });
  const N_LON = 8;
  const LON_SEG = 48;
  for (let m = 0; m < N_LON; m++) {
    const lon = (Math.PI * m) / N_LON;
    const pts = [];
    for (let s = 0; s <= LON_SEG; s++) {
      const t = (Math.PI * s) / LON_SEG; // 극각 0..π
      const y = Math.cos(t) * SPHERE_RADIUS;
      const r = Math.sin(t) * SPHERE_RADIUS;
      pts.push(new THREE.Vector3(r * Math.cos(lon), y, r * Math.sin(lon)));
    }
    qsphereBgGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), meridianMat));
  }

  // 적도(equator) — 살짝 강조
  const equatorPts = [];
  for (let s = 0; s <= 96; s++) {
    const a = (2 * Math.PI * s) / 96;
    equatorPts.push(new THREE.Vector3(Math.cos(a) * SPHERE_RADIUS, 0, Math.sin(a) * SPHERE_RADIUS));
  }
  qsphereBgGroup.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(equatorPts),
      new THREE.LineBasicMaterial({ color: 0x8b95a1, transparent: true, opacity: 0.4 })
    )
  );

  // 바깥 실루엣 원 — 항상 카메라를 향하는 great-circle 링으로 구 윤곽을 또렷하게.
  const silhouettePoints = [];
  for (let s = 0; s <= 96; s++) {
    const a = (2 * Math.PI * s) / 96;
    silhouettePoints.push(new THREE.Vector3(Math.cos(a) * SPHERE_RADIUS, Math.sin(a) * SPHERE_RADIUS, 0));
  }
  const silhouette = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(silhouettePoints),
    new THREE.LineBasicMaterial({ color: 0x8b95a1, transparent: true, opacity: 0.5 })
  );
  qsphereBgGroup.add(silhouette);

  // --- 위도(해밍 가중치) 링: 노드가 놓이는 위치. 큐비트 수 바뀔 때만 재생성 ---
  const qsphereRingsGroup = new THREE.Group();
  qsphereBgGroup.add(qsphereRingsGroup);
  let qsphereRingQubitCount = -1;
  function rebuildQSphereRings(qubitCount) {
    if (qubitCount === qsphereRingQubitCount) return;
    qsphereRingQubitCount = qubitCount;
    for (const child of qsphereRingsGroup.children.slice()) {
      qsphereRingsGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    const ringMat = new THREE.LineBasicMaterial({ color: 0x6b7684, transparent: true, opacity: 0.45 });
    const SEGMENTS = 64;
    for (let w = 1; w < qubitCount; w++) {
      const theta = (Math.PI * w) / qubitCount;
      const r = Math.sin(theta) * SPHERE_RADIUS;
      const y = Math.cos(theta) * SPHERE_RADIUS;
      const points = [];
      for (let s = 0; s <= SEGMENTS; s++) {
        const a = (2 * Math.PI * s) / SEGMENTS;
        points.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
      }
      qsphereRingsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMat));
    }
  }

  const qsphereStateGroup = new THREE.Group(); // 마커(점) + |ket⟩ phase 라벨
  const qspherePhaseGroup = new THREE.Group(); // 위상 색 스템 라인
  scene.add(qsphereStateGroup, qspherePhaseGroup);
  const qsphereMarkerGeo = new THREE.SphereGeometry(1, 12, 10);
  // 히트 영역용 투명 재질(눈에는 안 보이지만 raycaster는 맞힌다). 마커마다 공유한다.
  const HIT_SCALE = 1.9;
  const HIT_MATERIAL = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, depthTest: false,
  });

  // 위상(라디안)을 π의 간단한 분수로 표기 (0, π, π/2, 2π/3 ...), 아니면 소수 배수로 근사.
  const SIMPLE_FRACTIONS = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8],
  ];
  function formatPhase(rad) {
    const EPS = 0.02;
    let a = rad % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a <= -Math.PI) a += 2 * Math.PI;
    if (Math.abs(a) < EPS) return "0";
    if (Math.abs(Math.abs(a) - Math.PI) < EPS) return "π";
    const sign = a < 0 ? "-" : "";
    const absFrac = Math.abs(a) / Math.PI;
    for (const [num, den] of SIMPLE_FRACTIONS) {
      if (Math.abs(absFrac - num / den) < EPS) {
        return `${sign}${num === 1 ? "" : num}π/${den}`;
      }
    }
    return `${(a / Math.PI).toFixed(2)}π`;
  }

  function clearGroup(group) {
    for (const child of group.children.slice()) {
      group.remove(child);
      // Line(stem)만 개별 지오메트리를 갖는다. 마커는 qsphereMarkerGeo를 공유하고,
      // Sprite(라벨)는 three.js가 내부적으로 공유하는 싱글턴 지오메트리를 쓰므로
      // 절대 dispose하면 안 된다 (다른 모든 스프라이트가 함께 깨진다).
      if (child.isLine) child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  }

  // 확률 분포에 대한 Q-sphere 노드(마커·스템·라벨)를 그룹에 추가한다(그룹을 비우지 않음).
  // 반환: { material, base } 목록 — 크로스페이드에서 opacity를 개별 제어하기 위함.
  function addQSphereNodes(probabilities, qubitCount) {
    const nodes = [];
    if (!qubitCount) return nodes;
    const byWeight = new Map();
    for (const entry of probabilities) {
      const w = popcount(entry.index);
      if (!byWeight.has(w)) byWeight.set(w, []);
      byWeight.get(w).push(entry);
    }
    const PROB_EPS = 0.05; // %
    for (const [weight, entries] of byWeight) {
      const theta = (Math.PI * weight) / qubitCount;
      entries.forEach((entry, k) => {
        if (entry.probability < PROB_EPS) return;
        const phi = entries.length > 1 ? (2 * Math.PI * k) / entries.length : 0;
        const bx = Math.sin(theta) * Math.cos(phi);
        const by = Math.sin(theta) * Math.sin(phi);
        const bz = Math.cos(theta);
        const pos = blochToThree({ x: bx, y: by, z: bz }).multiplyScalar(SPHERE_RADIUS);
        const phaseRad = Math.atan2(entry.im, entry.re);
        const color = phaseToColor(phaseRad);

        const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos]);
        const stemMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
        qspherePhaseGroup.add(new THREE.Line(stemGeo, stemMat));
        nodes.push({ material: stemMat, base: 0.8 });

        const radius = 0.035 + 0.09 * Math.sqrt(entry.probability / 100);
        // 광택 구슬: 환경맵/조명을 받아 유리 구 안에서 빛나는 노드처럼 보이게 한다.
        const markerMat = new THREE.MeshStandardMaterial({
          color, roughness: 0.3, metalness: 0.0, emissive: color, emissiveIntensity: 0.28, transparent: true,
        });
        const marker = new THREE.Mesh(qsphereMarkerGeo, markerMat);
        marker.position.copy(pos);
        marker.scale.setScalar(radius);
        // hover 툴팁에 쓸 값. 화면 표시는 main.js가 맡고 여기선 데이터만 실어 둔다.
        marker.userData.node = {
          label: entry.label, index: entry.index, re: entry.re, im: entry.im,
          probability: entry.probability, phaseRad, phaseText: formatPhase(phaseRad), baseScale: radius,
        };
        qsphereStateGroup.add(marker);
        // 노드가 작아 정확히 겨냥하기 어려우므로 히트 영역을 시각 크기보다 크게 잡는다.
        // (보이지 않지만 raycast는 되도록 opacity 0 + depthWrite:false)
        const hit = new THREE.Mesh(qsphereMarkerGeo, HIT_MATERIAL);
        hit.scale.setScalar(HIT_SCALE);
        hit.userData.hitFor = marker;
        marker.add(hit);
        nodes.push({ material: markerMat, base: 1 });

        const label = makeWideLabelSprite(`|${entry.label}⟩ ${formatPhase(phaseRad)}`);
        label.position.copy(pos).multiplyScalar(1.18);
        qsphereStateGroup.add(label);
        nodes.push({ material: label.material, base: label.material.opacity });
      });
    }
    return nodes;
  }

  function setQSphereData(probabilities, qubitCount) {
    clearHover();
    clearGroup(qsphereStateGroup);
    clearGroup(qspherePhaseGroup);
    rebuildQSphereRings(qubitCount);
    addQSphereNodes(probabilities, qubitCount);
  }

  // ---------- [5] Q-sphere 노드 hover ----------
  // Raycaster로 히트 테스트하되 renderLoop에서 프레임당 1회만 처리한다(≤60fps 스로틀).
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let hoverDirty = false;
  let hoveredMarker = null;
  let onNodeHover = null; // main.js가 툴팁을 그리는 콜백

  function clearHover() {
    if (hoveredMarker) {
      hoveredMarker.scale.setScalar(hoveredMarker.userData.node.baseScale);
      hoveredMarker.material.emissiveIntensity = 0.28;
      hoveredMarker = null;
    }
    onNodeHover?.(null);
  }

  function updateHover() {
    if (!qsphereStateGroup.visible || !onNodeHover) return;
    raycaster.setFromCamera(pointerNdc, camera);
    // 히트 메쉬(마커의 자식)까지 포함해 재귀 검사. 결과는 카메라에서 가까운 순으로 정렬되므로
    // [0]만 보면 겹친 노드 중 가장 앞의 것만 잡힌다.
    const hits = raycaster.intersectObjects(qsphereStateGroup.children, true);
    const first = hits.find((h) => h.object.userData.hitFor || h.object.userData.node);
    const marker = first ? (first.object.userData.hitFor ?? first.object) : null;
    if (marker === hoveredMarker) {
      if (marker) onNodeHover(marker.userData.node, lastPointerClient);
      return;
    }
    clearHover();
    if (!marker) return;
    hoveredMarker = marker;
    marker.scale.setScalar(marker.userData.node.baseScale * 1.35); // hover 강조
    marker.material.emissiveIntensity = 0.6;
    onNodeHover(marker.userData.node, lastPointerClient);
  }

  let lastPointerClient = { x: 0, y: 0 };
  container.addEventListener("pointermove", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    lastPointerClient = { x: e.clientX, y: e.clientY };
    hoverDirty = true;
  });
  container.addEventListener("pointerleave", clearHover);

  // [3] 스텝 전환: 위치·색 보간 없이 짧은 크로스페이드. 이전 노드는 제자리에서 투명해지고,
  // 새 노드는 제자리에서 나타난다. slerp/hue 보간 없음.
  let qsCrossfadeRAF = null;
  function crossfadeQSphere(toProbs, qubitCount, duration) {
    if (qsCrossfadeRAF) { cancelAnimationFrame(qsCrossfadeRAF); qsCrossfadeRAF = null; }
    if (duration <= 0) { setQSphereData(toProbs, qubitCount); return; }
    // 현재 노드를 old로 캡처
    const oldNodes = [];
    for (const g of [qsphereStateGroup, qspherePhaseGroup]) {
      for (const child of g.children) {
        const mat = child.material;
        if (mat && mat.opacity !== undefined) {
          mat.transparent = true;
          oldNodes.push({ material: mat, base: mat.opacity, obj: child, group: g });
        }
      }
    }
    const newNodes = addQSphereNodes(toProbs, qubitCount); // 그룹에 추가(비우지 않음)
    for (const nn of newNodes) nn.material.opacity = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      for (const on of oldNodes) on.material.opacity = on.base * (1 - t);
      for (const nn of newNodes) nn.material.opacity = nn.base * t;
      if (t < 1) { qsCrossfadeRAF = requestAnimationFrame(step); return; }
      for (const on of oldNodes) { on.group.remove(on.obj); on.obj.geometry?.dispose?.(); on.material.dispose?.(); }
      for (const nn of newNodes) nn.material.opacity = nn.base;
      qsCrossfadeRAF = null;
    };
    qsCrossfadeRAF = requestAnimationFrame(step);
  }

  function setMode(nextMode) {
    sceneMode = nextMode;
    const isBloch = sceneMode === "bloch";
    applyBlochVisibility(); // 화살표/원점점/내부구는 |r| 상태에 따라
    if (trailMesh) trailMesh.visible = isBloch;
    xLabel.visible = isBloch;
    yLabel.visible = isBloch;
    axisX.visible = isBloch;
    axisY.visible = isBloch;
    axisZ.visible = isBloch;
    blochGridGroup.visible = isBloch;
    qsphereBgGroup.visible = !isBloch;
    qsphereStateGroup.visible = !isBloch;
    qspherePhaseGroup.visible = !isBloch;
    // Q-sphere 모드에서는 weight-0/weight-n 마커 라벨이 극에 동일한 정보(+위상)를
    // 이미 표시하므로, 고정 극 라벨은 숨겨서 겹침을 피한다.
    zeroLabel.visible = isBloch;
    oneLabel.visible = isBloch;
    if (isBloch) {
      updateLabelSprite(zeroLabel, "|0⟩");
      updateLabelSprite(oneLabel, "|1⟩");
    }
  }

  renderLoop();

  return {
    setVectorInstant,
    animateVectorTo,
    resetView,
    clearTrail,
    setMode,
    setQSphereData,
    crossfadeQSphere,
    // [5] 노드 hover 콜백 등록: (node|null, {x,y} 화면좌표) — 툴팁 렌더는 main.js가 맡는다.
    setNodeHoverHandler(fn) { onNodeHover = fn; },
  };
}
