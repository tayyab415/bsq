import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const dom = {
  scene: document.getElementById("scene"),
  status: document.getElementById("status"),
  shotSearch: document.getElementById("shotSearch"),
  familyFilter: document.getElementById("familyFilter"),
  summaryStats: document.getElementById("summaryStats"),
  shotList: document.getElementById("shotList"),
  shotContext: document.getElementById("shotContext"),
  shotTitle: document.getElementById("shotTitle"),
  frameBadge: document.getElementById("frameBadge"),
  frameSlider: document.getElementById("frameSlider"),
  prevFrameButton: document.getElementById("prevFrameButton"),
  nextFrameButton: document.getElementById("nextFrameButton"),
  broadcastViewButton: document.getElementById("broadcastViewButton"),
  contactButton: document.getElementById("contactButton"),
  impactButton: document.getElementById("impactButton"),
  biomechButton: document.getElementById("biomechButton"),
  candidateStrip: document.getElementById("candidateStrip"),
  selectedByBadge: document.getElementById("selectedByBadge"),
  scoreGrid: document.getElementById("scoreGrid"),
  frameLogic: document.getElementById("frameLogic"),
  biomechInputs: document.getElementById("biomechInputs"),
  physicsInputs: document.getElementById("physicsInputs"),
  routerContext: document.getElementById("routerContext"),
  contactVerdict: document.getElementById("contactVerdict"),
  familyVerdict: document.getElementById("familyVerdict"),
  storyVerdict: document.getElementById("storyVerdict"),
  manualNotes: document.getElementById("manualNotes"),
};

const state = {
  summary: null,
  shot: null,
  frame: null,
  frames: new Map(),
  currentFrameNumber: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  pitchGroup: null,
  skeletonGroup: null,
  overlayGroup: null,
  bodyConnections: [
    ["left_ear", "nose"], ["right_ear", "nose"], ["nose", "neck"],
    ["neck", "left_shoulder"], ["neck", "right_shoulder"], ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"], ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["neck", "pelvis"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"],
    ["left_hip", "pelvis"], ["right_hip", "pelvis"], ["left_hip", "left_knee"],
    ["left_knee", "left_ankle"], ["left_ankle", "left_heel"], ["left_ankle", "left_toe"],
    ["left_heel", "left_toe"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
    ["right_ankle", "right_heel"], ["right_ankle", "right_toe"], ["right_heel", "right_toe"],
  ],
};

const materials = {
  home: new THREE.MeshStandardMaterial({ color: 0xe04444, roughness: 0.52 }),
  away: new THREE.MeshStandardMaterial({ color: 0x6bb7ff, roughness: 0.52 }),
  selected: new THREE.MeshStandardMaterial({ color: 0x75d6a1, emissive: 0x183d28, roughness: 0.4 }),
  joint: new THREE.MeshStandardMaterial({ color: 0x76d487, roughness: 0.44 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xf2bf5e, roughness: 0.38 }),
  impact: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.78 }),
  biomech: new THREE.MeshBasicMaterial({ color: 0x7bb8ff, transparent: true, opacity: 0.72 }),
  boneHome: new THREE.MeshStandardMaterial({ color: 0xe86666, roughness: 0.5 }),
  boneAway: new THREE.MeshStandardMaterial({ color: 0x8bc8ff, roughness: 0.5 }),
  shooterLeft: new THREE.MeshStandardMaterial({ color: 0x4ea4ff, emissive: 0x102846, roughness: 0.42 }),
  shooterRight: new THREE.MeshStandardMaterial({ color: 0xff9b42, emissive: 0x402106, roughness: 0.42 }),
  shooterCenter: new THREE.MeshStandardMaterial({ color: 0x75d6a1, emissive: 0x183d28, roughness: 0.4 }),
  footProbe: new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95 }),
  shoulderProbe: new THREE.LineBasicMaterial({ color: 0x7bb8ff, transparent: true, opacity: 0.95 }),
  hipProbe: new THREE.LineBasicMaterial({ color: 0xf2bf5e, transparent: true, opacity: 0.95 }),
  torsoProbe: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
  velocityProbe: new THREE.LineBasicMaterial({ color: 0xff6f91, transparent: true, opacity: 0.95 }),
  velocityHead: new THREE.MeshBasicMaterial({ color: 0xff6f91 }),
};

const jointGeometry = new THREE.SphereGeometry(0.085, 10, 10);
const ballGeometry = new THREE.SphereGeometry(0.16, 18, 18);
const plantGeometry = new THREE.RingGeometry(0.22, 0.36, 24);
const labelWorldPosition = new THREE.Vector3();

init().catch((error) => {
  console.error(error);
  setStatus(`Error: ${error.message}`);
});

async function init() {
  setupScene();
  bindControls();
  state.summary = await fetchJson("/api/shooting/summary");
  renderSummary();
  renderShotList();
  const first = state.summary.shots[0];
  if (first) {
    await selectShot(first.matchFolder, first.eventId);
  }
  animate();
}

function setupScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x080909);
  state.camera = new THREE.PerspectiveCamera(48, dom.scene.clientWidth / dom.scene.clientHeight, 0.1, 1000);
  state.camera.position.set(0, 38, -58);

  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(dom.scene.clientWidth, dom.scene.clientHeight);
  dom.scene.appendChild(state.renderer.domElement);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.target.set(0, 0, 0);
  state.controls.enableDamping = true;
  state.controls.maxPolarAngle = Math.PI * 0.49;
  state.controls.minDistance = 12;
  state.controls.maxDistance = 120;

  const ambient = new THREE.HemisphereLight(0xffffff, 0x2f2b23, 2.0);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(18, 38, 12);
  state.scene.add(ambient, key);
  state.pitchGroup = new THREE.Group();
  state.skeletonGroup = new THREE.Group();
  state.overlayGroup = new THREE.Group();
  state.scene.add(state.pitchGroup, state.skeletonGroup, state.overlayGroup);
  drawPitch();
  window.addEventListener("resize", resizeRenderer);
}

function bindControls() {
  dom.shotSearch.addEventListener("input", renderShotList);
  dom.familyFilter.addEventListener("change", renderShotList);
  dom.frameSlider.addEventListener("input", () => loadFrame(Number(dom.frameSlider.value)));
  dom.prevFrameButton.addEventListener("click", () => loadFrame((state.currentFrameNumber ?? 0) - 1));
  dom.nextFrameButton.addEventListener("click", () => loadFrame((state.currentFrameNumber ?? 0) + 1));
  dom.broadcastViewButton.addEventListener("click", setBroadcastView);
  dom.contactButton.addEventListener("click", () => {
    const frame = state.shot?.frameWindow?.contact;
    if (frame) loadFrame(frame);
  });
  dom.impactButton.addEventListener("click", () => {
    const frame = state.shot?.frameWindow?.physicsExit || state.shot?.frameWindow?.impact;
    if (frame) loadFrame(frame);
  });
  dom.biomechButton.addEventListener("click", () => {
    const frame = state.shot?.frameWindow?.biomech;
    if (frame) loadFrame(frame);
  });
  for (const el of [dom.contactVerdict, dom.familyVerdict, dom.storyVerdict, dom.manualNotes]) {
    el.addEventListener("input", saveManualReview);
  }
}

function renderSummary() {
  const qPositive = state.summary.shots.filter((shot) => Number(shot.Q) > 0).length;
  const decisive = state.summary.shots.filter((shot) => ["position_delta_jump", "decisive_jump"].includes(shot.selectedBy)).length;
  dom.summaryStats.innerHTML = [
    statCell(state.summary.shotCount, "shots"),
    statCell(qPositive, "Q > 0"),
    statCell(decisive, "physics picks"),
  ].join("");
  for (const family of Object.keys(state.summary.familyCounts).sort()) {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = family;
    dom.familyFilter.appendChild(option);
  }
}

function renderShotList() {
  const query = dom.shotSearch.value.trim().toLowerCase();
  const family = dom.familyFilter.value;
  const rows = state.summary.shots.filter((shot) => {
    const text = `${shot.eventId} ${shot.matchFolder} ${shot.player} ${shot.team}`.toLowerCase();
    return (!query || text.includes(query)) && (family === "all" || shot.family === family);
  });
  dom.shotList.innerHTML = "";
  for (const shot of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shot-card ${state.shot?.shot?.eventId === shot.eventId ? "active" : ""}`;
    button.innerHTML = `
      <div class="shot-line">
        <span class="shot-name">${escapeHtml(shot.player || shot.eventId)}</span>
        <span class="family-pill family-${escapeHtml(shot.family)}">${escapeHtml(shot.family)}</span>
      </div>
      <div class="shot-meta">${escapeHtml(shot.matchFolder)} · TM ${fmt(shot.techniqueMechanics)} · ${escapeHtml(shot.techniqueMechanicsBand || "")} · Q ${fmt(shot.Q)}</div>
    `;
    button.addEventListener("click", () => selectShot(shot.matchFolder, shot.eventId));
    dom.shotList.appendChild(button);
  }
}

async function selectShot(matchFolder, eventId) {
  setStatus(`Loading shot ${eventId}`);
  state.shot = await fetchJson(`/api/shooting/shot?matchFolder=${encodeURIComponent(matchFolder)}&eventId=${encodeURIComponent(eventId)}`);
  state.frames.clear();
  state.frame = null;
  state.currentFrameNumber = null;
  clearGroup(state.skeletonGroup);
  clearGroup(state.overlayGroup);
  renderShotDetails();
  renderShotList();
  configureFrameControls();
  try {
    await loadFrame(state.shot.frameWindow.impact || state.shot.frameWindow.start);
    setBroadcastView();
  } catch (error) {
    console.error(error);
    setStatus(`Frame load blocked: ${error.message}`);
    dom.frameBadge.textContent = "Frame unavailable";
  }
  try {
    await preloadShotFrames();
  } catch (error) {
    console.error(error);
    setStatus(`Window preload blocked: ${error.message}`);
  }
  restoreManualReview();
}

function renderShotDetails() {
  const { shot, score, features, candidates, router } = state.shot;
  const roles = frameRoles();
  dom.shotContext.textContent = `${shot.matchFolder} · ${shot.eventId}`;
  dom.shotTitle.textContent = `${shot.player || "Unknown"} · ${shot.team || ""}`;
  dom.selectedByBadge.textContent = signalLabel(roles.selectionSignal || candidates[0]?.selected_by);
  dom.selectedByBadge.className = "badge";
  dom.scoreGrid.innerHTML = [
    moduleScoreCell("Technique Mechanics", state.shot.modules?.technique_mechanics || state.shot.modules?.technique),
    moduleScoreCell("Shot Geometry", state.shot.modules?.shot_geometry || state.shot.modules?.positioning),
    moduleScoreCell("Arrival / Receiving", state.shot.modules?.arrival_receiving || state.shot.modules?.receiving_pressure),
    moduleScoreCell("Approach Prep", state.shot.modules?.approach_prep),
    moduleScoreCell("Placement", state.shot.modules?.placement),
    moduleScoreCell("Strike Quality", state.shot.modules?.strike_quality || state.shot.modules?.strike_output),
    moduleScoreCell("P4 Mechanics", state.shot.modules?.P4_mech),
    moduleScoreCell("P4 Strike", state.shot.modules?.P4_strike),
    moduleScoreCell("Decision Quality", state.shot.modules?.decision_quality),
    moduleScoreCell("Carry Progression", state.shot.modules?.carry_progression),
    renderPhaseScores(state.shot.phaseScores),
    scoreCell("Legacy Add", score.additive_score),
    scoreCell("Legacy EAR", score.ear_score),
    scoreCell("Legacy Q", score.Q),
    scoreCell("Weak", score.weakest_constraint),
  ].join("");
  dom.frameLogic.innerHTML = kvList([
    ["Anchor frame", shot.anchorFrame],
    ["Contact / impulse frame", roles.contactFrame || state.shot.frameWindow.contact],
    ["Physics exit frame", roles.physicsExitFrame || state.shot.frameWindow.impact],
    ["Visual contact frame", roles.visualContactFrame || state.shot.frameWindow.biomech],
    ["Biomech frame", roles.biomechFrame || state.shot.frameWindow.biomech],
    ["Strike interval", intervalLabel(roles)],
    ["P3 backswing", phaseLabel(state.shot.phases?.P3)],
    ["P4 impact", phaseLabel(state.shot.phases?.P4)],
    ["P5 follow-through", phaseLabel(state.shot.phases?.P5)],
    ["P1 affordance", phaseScoreLabel(state.shot.phaseScores?.P1)],
    ["P2 approach", phaseScoreLabel(state.shot.phaseScores?.P2)],
    ["P6 flight", phaseScoreLabel(state.shot.phaseScores?.P6)],
    ["Selection signal", signalLabel(roles.selectionSignal || candidates[0]?.selected_by)],
    ["Nearest part at contact", roles.nearestPartAtExit || candidates[0]?.nearest_part],
    ["q_contact", features.q_contact],
    ["q_sync", features.q_sync],
    ["q_anchor", features.q_anchor],
    ["q_candidate", features.q_candidate],
    ["q_foot", features.q_foot],
    ["q_occlusion", features.q_occlusion],
  ]);
  dom.biomechInputs.innerHTML = kvList([
    ["Foot", features.inferred_foot],
    ["Foot-ball distance", meters(features.min_foot_ball_distance_m)],
    ["Contact near ankle", features.contact_near_ankle_score],
    ["Plant forward", meters(features.plant_foot_forward_offset_m)],
    ["Plant lateral", meters(features.plant_foot_lateral_offset_m)],
    ["Foot path stability", features.foot_path_stability],
    ["Shoulder-hip sep.", degrees(features.shoulder_hip_separation_deg)],
    ["Peak shoulder-hip sep.", degrees(features.peak_shoulder_hip_separation_deg)],
    ["Shot direction", vector2Label(features.shot_direction_x, features.shot_direction_y)],
    ["Torso lean", degrees(features.torso_lean_deg)],
    ["Knee stability", features.knee_stability_score],
    ["Knee lateral track stdev", meters(features.plant_knee_lateral_track_stdev_m)],
    ["Knee peak velocity", `${fmt(features.knee_peak_angular_velocity_dps)} deg/s`],
    ["Knee peak score", features.knee_peak_angular_velocity_score],
    ["Foot peak velocity", `${fmt(features.foot_peak_velocity_at_contact)} m/s`],
    ["Foot peak score", features.foot_peak_velocity_score],
    ["Arm abduction", degrees(features.non_kicking_arm_abduction_deg)],
    ["Arm abduction score", features.non_kicking_arm_abduction_score],
    ["Sequencing score", features.proximal_distal_sequencing_score],
    ["Ankle rigidity", features.ankle_rigidity_score],
    ["P4 Mechanics", phaseScoreLabel(state.shot.modules?.P4_mech)],
    ["P4 Strike", phaseScoreLabel(state.shot.modules?.P4_strike)],
    ["P2 Approach", phaseScoreLabel(state.shot.phaseScores?.P2)],
    ["Approach speed", `${fmt(features.approach_speed_m_s)} m/s`],
    ["Approach angle", degrees(features.approach_angle_deg)],
    ["Prep forward", meters(features.prep_ball_forward_m)],
    ["Prep lateral", meters(features.prep_ball_lateral_m)],
    ["Convergence", features.ball_shooter_convergence_score],
    ["Trunk lean approach", degrees(features.trunk_lean_approach_deg)],
    ["Readiness", features.body_ball_readiness_score],
  ]);
  dom.physicsInputs.innerHTML = kvList([
    ["Exit speed", `${fmt(features.ball_exit_speed_m_s)} m/s`],
    ["Launch angle", degrees(features.launch_angle_deg)],
    ["Ball z at contact", meters(features.ball_z_at_contact)],
    ["Delta speed at contact", `${fmt(features.position_delta_speed_m_s)} m/s`],
    ["Delta speed jump", `${fmt(features.position_delta_jump_m_s)} m/s`],
    ["Parquet velocity at contact", `${fmt(features.parquet_ball_speed_m_s)} m/s`],
    ["Parquet velocity jump", `${fmt(features.parquet_velocity_jump_m_s)} m/s`],
    ["Parquet exit speed", `${fmt(features.parquet_exit_speed_m_s)} m/s`],
    ["V exit speed score", score.V_exit_speed],
    ["V launch score", score.V_launch_angle],
    ["P6 Flight", phaseScoreLabel(state.shot.phaseScores?.P6)],
    ["Initial velocity", velocityLabel(state.shot.flight?.initialVelocity)],
    ["Goal plane y", meters(state.shot.flight?.goalPlane?.y)],
    ["Goal plane z", meters(state.shot.flight?.goalPlane?.z)],
    ["Blocked flight", state.shot.flight?.blockedFlight],
    ["Goal alignment score", features.initial_goal_alignment_score || score.initial_goal_alignment_score],
    ["Lateral score", features.goal_plane_lateral_score || score.goal_plane_lateral_score],
    ["Vertical score", features.goal_plane_vertical_score || score.goal_plane_vertical_score],
  ]);
  dom.routerContext.innerHTML = kvList([
    ["Family", score.family],
    ["Previous play", router.previous_play_id],
    ["Previous type", router.previous_play_type],
    ["Previous cross", router.previous_is_cross],
    ["Passer", router.previous_passer_id],
    ["Receiver", router.previous_receiver_id],
    ["End x/y", `${router.previous_end_x || ""}, ${router.previous_end_y || ""}`],
    ["Reason", router.router_reason],
  ]);
  renderCandidateStrip();
}

function renderCandidateStrip() {
  dom.candidateStrip.innerHTML = "";
  for (const row of state.shot.candidates.slice(0, 5)) {
    const role = candidateRole(row);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `candidate-button ${row.selected === "True" || row.candidate_rank === "1" ? "selected" : ""}`;
    button.innerHTML = `
      <strong>#${escapeHtml(row.candidate_rank)} · ${escapeHtml(row.candidate_frame)} · ${escapeHtml(role)}</strong>
      <small>off ${escapeHtml(row.frame_offset)} · nearest ${escapeHtml(row.nearest_part)} · ${escapeHtml(signalLabel(row.selected_by))}</small>
      <small>dist ${fmt(row.foot_ball_distance_m)}m · delta jump ${fmt(row.velocity_jump_m_s)}m/s</small>
      <small>delta ${fmt(row.position_delta_speed_m_s)}m/s · parquet ${fmt(row.parquet_ball_speed_m_s)}m/s</small>
    `;
    button.addEventListener("click", () => loadFrame(Number(row.candidate_frame)));
    dom.candidateStrip.appendChild(button);
  }
}

function configureFrameControls() {
  const { start, end, contact, impact } = state.shot.frameWindow;
  dom.frameSlider.min = String(start);
  dom.frameSlider.max = String(end);
  dom.frameSlider.value = String(contact || impact || start);
}

async function preloadShotFrames() {
  const { shot, frameWindow } = state.shot;
  const payload = await fetchJson(
    `/api/shooting/chunk?matchFolder=${encodeURIComponent(shot.matchFolder)}&startFrame=${frameWindow.start}&endFrame=${frameWindow.end}&stride=1`
  );
  for (const frame of payload.frames || []) {
    state.frames.set(frame.frameNumber, frame);
  }
  setStatus(`Loaded ${state.frames.size} frames for ${shot.eventId}`);
}

async function loadFrame(frameNumber) {
  if (!state.shot) return;
  let frame = state.frames.get(frameNumber);
  if (!frame) {
    const payload = await fetchJson(`/api/shooting/frame?matchFolder=${encodeURIComponent(state.shot.shot.matchFolder)}&frame=${frameNumber}`);
    frame = payload.frame;
    if (frame) state.frames.set(frame.frameNumber, frame);
  }
  if (!frame) {
    setStatus(`No frame ${frameNumber}`);
    return;
  }
  state.frame = frame;
  state.currentFrameNumber = frame.frameNumber;
  dom.frameBadge.textContent = frameBadgeLabel(frame.frameNumber);
  dom.frameSlider.value = String(frame.frameNumber);
  renderFrame(frame);
  setStatus(`Rendered frame ${frame.frameNumber} with ${(frame.players || []).length} players`);
}

function renderFrame(frame) {
  clearGroup(state.skeletonGroup);
  clearGroup(state.overlayGroup);
  const shooter = state.shot?.shot?.player;
  const shooterPlayer = (frame.players || []).find((player) => shooter && player.name === shooter);
  if (frame.ball?.position) {
    const ball = new THREE.Mesh(ballGeometry, materials.ball);
    ball.position.copy(toThree(frame.ball.position));
    state.skeletonGroup.add(ball);
    addFrameMarker(frame);
  }
  for (const player of frame.players || []) {
    renderPlayer(player, shooter);
  }
  if (shooterPlayer) renderShotOverlays(frame, shooterPlayer);
}

function renderPlayer(player, shooterName) {
  const group = new THREE.Group();
  const isShooter = shooterName && player.name === shooterName;
  const boneMaterial = player.teamCode === 1 ? materials.boneHome : materials.boneAway;
  for (const [from, to] of state.bodyConnections) {
    const a = player.parts[from];
    const b = player.parts[to];
    if (a && b) group.add(cylinderBetween(toThree(a), toThree(b), isShooter ? 0.052 : 0.032, segmentMaterial(from, to, boneMaterial, isShooter)));
  }
  for (const [name, point] of Object.entries(player.parts)) {
    const joint = new THREE.Mesh(jointGeometry, jointMaterial(name, isShooter));
    joint.position.copy(toThree(point));
    group.add(joint);
  }
  if (player.parts.neck && (isShooter || player.nearestBallDistance < 2.0)) {
    const label = makeLabel(`${player.jerseyNumber} ${player.name}`, { kind: isShooter ? "shooter" : "player" });
    label.position.copy(toThree(player.parts.neck));
    label.position.y += isShooter ? 1.0 : 0.7;
    group.add(label);
  }
  state.skeletonGroup.add(group);
}

function segmentMaterial(from, to, fallback, isShooter) {
  if (!isShooter) return fallback;
  if (isLeftPart(from) && isLeftPart(to)) return materials.shooterLeft;
  if (isRightPart(from) && isRightPart(to)) return materials.shooterRight;
  return materials.shooterCenter;
}

function jointMaterial(partName, isShooter) {
  if (!isShooter) return materials.joint;
  if (isLeftPart(partName)) return materials.shooterLeft;
  if (isRightPart(partName)) return materials.shooterRight;
  return materials.shooterCenter;
}

function isLeftPart(partName) {
  return partName.startsWith("left_");
}

function isRightPart(partName) {
  return partName.startsWith("right_");
}

function addFrameMarker(frame) {
  const ball = frame.ball?.position;
  if (!ball || !state.shot) return;
  const impact = state.shot.frameWindow.impact;
  const contact = state.shot.frameWindow.contact;
  const biomech = state.shot.frameWindow.biomech;
  if (frame.frameNumber !== impact && frame.frameNumber !== contact && frame.frameNumber !== biomech) return;
  const role = frameRole(frame.frameNumber);
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(frame.frameNumber === impact ? 0.42 : 0.32, 0.018, 8, 28),
    frame.frameNumber === impact ? materials.impact : materials.biomech
  );
  marker.position.copy(toThree(ball));
  marker.rotation.x = Math.PI / 2;
  state.overlayGroup.add(marker);
  const label = makeLabel(role.toUpperCase(), { kind: "tag" });
  label.position.copy(toThree(ball));
  label.position.y += 0.75;
  state.overlayGroup.add(label);
}

function frameRoles() {
  return state.shot?.frameRoles || {};
}

function frameRole(frameNumber) {
  const roles = frameRoles();
  const isExit = Number(frameNumber) === Number(roles.physicsExitFrame || state.shot?.frameWindow?.impact);
  const isImpulse = Number(frameNumber) === Number(roles.contactFrame || state.shot?.frameWindow?.contact);
  const isContact = Number(frameNumber) === Number(roles.visualContactFrame || state.shot?.frameWindow?.biomech);
  if (isExit && (isImpulse || isContact)) return "exit + contact";
  if (isExit) return "physics exit";
  if (isImpulse) return "contact / impulse";
  if (isContact) return "visual contact";
  return "candidate";
}

function candidateRole(row) {
  return frameRole(Number(row.candidate_frame));
}

function frameBadgeLabel(frameNumber) {
  const role = frameRole(frameNumber);
  return role === "candidate" ? `Frame ${frameNumber}` : `Frame ${frameNumber} · ${role}`;
}

function intervalLabel(roles) {
  const start = roles.strikeIntervalStart;
  const end = roles.strikeIntervalEnd;
  if (!start && !end) return "";
  if (String(start) === String(end)) return String(start);
  return `${start}-${end}`;
}

function phaseLabel(phase) {
  if (!phase || !phase.available) return "";
  return `${phase.start}-${phase.end}`;
}

function signalLabel(signal) {
  if (signal === "position_delta_jump") return "position delta jump";
  if (signal === "decisive_jump" || signal === "ball_velocity_jump") return "ball velocity jump";
  if (signal === "contact_cost" || signal === "cost") return "contact cost";
  return signal || "-";
}

function renderShotOverlays(frame, shooter) {
  const features = state.shot?.features || {};
  const ball = frame.ball?.position;
  const candidate = candidateForFrame(frame.frameNumber) || state.shot?.candidates?.[0] || {};
  const inferredFoot = features.inferred_foot || candidate.inferred_foot;
  const nearestPart = candidate.nearest_part || footPart(inferredFoot, "toe");
  const contactPoint = shooter.parts[nearestPart] || shooter.parts[footPart(inferredFoot, "toe")] || shooter.parts[footPart(inferredFoot, "ankle")];

  if (ball && contactPoint) {
    addProbeLine(toThree(contactPoint), toThree(ball), materials.footProbe);
    const label = makeLabel(`${nearestPart} to ball`, { kind: "probe" });
    label.position.copy(toThree(contactPoint));
    label.position.y += 0.5;
    state.overlayGroup.add(label);
  }

  const plantFoot = features.plant_foot || oppositeFoot(inferredFoot);
  const plantPoint = shooter.parts[footPart(plantFoot, "toe")] || shooter.parts[footPart(plantFoot, "heel")] || shooter.parts[footPart(plantFoot, "ankle")];
  if (plantPoint) {
    const marker = new THREE.Mesh(plantGeometry, materials.biomech);
    marker.position.copy(toThree(plantPoint));
    marker.position.y += 0.04;
    marker.rotation.x = Math.PI / 2;
    state.overlayGroup.add(marker);
    const label = makeLabel(`${plantFoot || "plant"} plant`, { kind: "probe" });
    label.position.copy(toThree(plantPoint));
    label.position.y += 0.55;
    state.overlayGroup.add(label);
  }

  addPartAxis(shooter, "left_shoulder", "right_shoulder", materials.shoulderProbe, "shoulders");
  addPartAxis(shooter, "left_hip", "right_hip", materials.hipProbe, "hips");
  addPartAxis(shooter, "neck", "pelvis", materials.torsoProbe, "torso");

  if (ball && frame.ball?.velocity) {
    const start = toThree(ball);
    const velocity = new THREE.Vector3(frame.ball.velocity.x, frame.ball.velocity.z, -frame.ball.velocity.y).multiplyScalar(0.12);
    const end = start.clone().add(velocity);
    addProbeLine(start, end, materials.velocityProbe);
    addArrowHead(start, end, materials.velocityProbe);
    const deltaSpeed = candidate.position_delta_speed_m_s ? ` · delta ${fmt(candidate.position_delta_speed_m_s)}` : "";
    const label = makeLabel(`parquet v ${fmt(vectorLength(frame.ball.velocity))}${deltaSpeed} m/s`, { kind: "probe" });
    label.position.copy(end);
    label.position.y += 0.55;
    state.overlayGroup.add(label);
  }
}

function candidateForFrame(frameNumber) {
  return (state.shot?.candidates || []).find((row) => Number(row.candidate_frame) === Number(frameNumber));
}

function footPart(foot, part) {
  if (!foot) return "";
  return `${foot}_${part}`;
}

function oppositeFoot(foot) {
  if (foot === "left") return "right";
  if (foot === "right") return "left";
  return "";
}

function addPartAxis(player, leftName, rightName, material, labelText) {
  const left = player.parts[leftName];
  const right = player.parts[rightName];
  if (!left || !right) return;
  const a = toThree(left);
  const b = toThree(right);
  addProbeLine(a, b, material);
  const label = makeLabel(labelText, { kind: "probe" });
  label.position.copy(a.clone().add(b).multiplyScalar(0.5));
  label.position.y += 0.45;
  state.overlayGroup.add(label);
}

function addProbeLine(a, b, material) {
  state.overlayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), material));
}

function addArrowHead(start, end, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  if (direction.length() < 0.01) return;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16), materials.velocityHead);
  cone.position.copy(end);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  state.overlayGroup.add(cone);
}

function drawPitch() {
  const length = 105;
  const width = 68;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(length, width),
    new THREE.MeshStandardMaterial({ color: 0x285f3f, roughness: 0.9 })
  );
  plane.rotation.x = -Math.PI / 2;
  state.pitchGroup.add(plane);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe9efe5, transparent: true, opacity: 0.74 });
  addRectLine(-length / 2, -width / 2, length, width, lineMaterial);
  addLine([0, 0, -width / 2], [0, 0, width / 2], lineMaterial);
  addCircle(0, 0, 9.15, lineMaterial);
  addRectLine(-length / 2, -20.16, 16.5, 40.32, lineMaterial);
  addRectLine(length / 2 - 16.5, -20.16, 16.5, 40.32, lineMaterial);
  addRectLine(-length / 2, -9.16, 5.5, 18.32, lineMaterial);
  addRectLine(length / 2 - 5.5, -9.16, 5.5, 18.32, lineMaterial);
}

function addRectLine(x, y, width, height, material) {
  const points = [[x, 0.03, y], [x + width, 0.03, y], [x + width, 0.03, y + height], [x, 0.03, y + height], [x, 0.03, y]].map(([px, py, pz]) => new THREE.Vector3(px, py, pz));
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}

function addLine(a, b, material) {
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), material));
}

function addCircle(x, y, radius, material) {
  const points = [];
  for (let i = 0; i <= 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, 0.035, y + Math.sin(angle) * radius));
  }
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}

function cylinderBetween(a, b, radius, material) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function makeLabel(text, options = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 58;
  ctx.fillStyle = "rgba(16,17,18,0.82)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f0f3f2";
  const fontSize = options.kind === "probe" ? 16 : 18;
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.fillText(text, 12, 35);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  const scale = labelBaseScale(options.kind);
  sprite.scale.copy(scale);
  sprite.userData.dynamicLabel = true;
  sprite.userData.baseScale = scale;
  return sprite;
}

function labelBaseScale(kind) {
  if (kind === "shooter") return new THREE.Vector3(2.8, 0.64, 1);
  if (kind === "player") return new THREE.Vector3(2.1, 0.48, 1);
  if (kind === "tag") return new THREE.Vector3(2.0, 0.46, 1);
  return new THREE.Vector3(1.75, 0.4, 1);
}

function toThree(point) {
  return new THREE.Vector3(point.x, point.z, -point.y);
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose?.());
      else if (node.material?.map) {
        node.material.map.dispose?.();
        node.material.dispose?.();
      }
    });
  }
}

function resizeRenderer() {
  state.camera.aspect = dom.scene.clientWidth / dom.scene.clientHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(dom.scene.clientWidth, dom.scene.clientHeight);
}

function setBroadcastView() {
  const target = state.frame?.ball?.position ? toThree(state.frame.ball.position) : new THREE.Vector3(0, 0, 0);
  const offset = state.frame?.ball?.position ? new THREE.Vector3(22, 18, -36) : new THREE.Vector3(0, 38, -58);
  state.controls.target.copy(target);
  state.camera.position.copy(target).add(offset);
  state.camera.lookAt(target);
  state.controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  state.controls.update();
  updateLabelScales();
  state.renderer.render(state.scene, state.camera);
}

function updateLabelScales() {
  for (const group of [state.skeletonGroup, state.overlayGroup]) {
    group.traverse((node) => {
      if (!node.userData?.dynamicLabel) return;
      node.getWorldPosition(labelWorldPosition);
      const distance = state.camera.position.distanceTo(labelWorldPosition);
      const zoomFactor = THREE.MathUtils.clamp(distance / 44, 0.18, 0.9);
      node.scale.copy(node.userData.baseScale).multiplyScalar(zoomFactor);
    });
  }
}

function saveManualReview() {
  if (!state.shot) return;
  const key = manualKey();
  localStorage.setItem(key, JSON.stringify({
    contact: dom.contactVerdict.value,
    family: dom.familyVerdict.value,
    story: dom.storyVerdict.value,
    notes: dom.manualNotes.value,
  }));
}

function restoreManualReview() {
  const stored = JSON.parse(localStorage.getItem(manualKey()) || "{}");
  dom.contactVerdict.value = stored.contact || "";
  dom.familyVerdict.value = stored.family || "";
  dom.storyVerdict.value = stored.story || "";
  dom.manualNotes.value = stored.notes || "";
}

function manualKey() {
  return `shooting-eye-test:${state.shot.shot.matchFolder}:${state.shot.shot.eventId}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `Request failed: ${url}`);
  return payload;
}

function statCell(value, label) {
  return `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function scoreCell(label, value) {
  return `<div class="score-cell"><strong>${escapeHtml(fmt(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function moduleScoreCell(label, module) {
  const score = module?.score;
  const quality = module?.q;
  const displayLabel = module?.label || label;
  const band = module?.band;
  const qualityLabel = band && band !== "ok" ? band.replaceAll("_", " ") : `q ${fmt(quality)}`;
  return `
    <div class="score-cell module-score-cell">
      <strong>${escapeHtml(fmt(score))}</strong>
      <span>${escapeHtml(displayLabel)}</span>
      <small>${escapeHtml(qualityLabel)}</small>
    </div>
  `;
}

function renderPhaseScores(phases) {
  if (!phases) return "";
  return ["P1", "P2", "P3", "P4", "P5", "P6"]
    .map((phase) => moduleScoreCell(phase, { score: phases[phase]?.score, q: phases[phase]?.q }))
    .join("");
}

function phaseScoreLabel(phase) {
  if (!phase) return "";
  return `${fmt(phase.score)} / q ${fmt(phase.q)}`;
}

function velocityLabel(velocity) {
  if (!velocity) return "";
  return `${fmt(velocity.x)}, ${fmt(velocity.y)}, ${fmt(velocity.z)} · ${fmt(velocity.speed)} m/s`;
}

function vector2Label(x, y) {
  if (x === undefined || x === null || x === "" || y === undefined || y === null || y === "") return "";
  return `${fmt(x)}, ${fmt(y)}`;
}

function kvList(rows) {
  return rows.map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><span>${escapeHtml(value ?? "")}</span></div>`).join("");
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value ?? "";
  return Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(2);
}

function meters(value) {
  return value === undefined || value === null || value === "" ? "" : `${fmt(value)} m`;
}

function degrees(value) {
  return value === undefined || value === null || value === "" ? "" : `${fmt(value)}°`;
}

function vectorLength(vector) {
  return Math.hypot(Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0);
}

function setStatus(text) {
  dom.status.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
