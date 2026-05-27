import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const dom = {
  scene: document.getElementById("scene"),
  miniPitch: document.getElementById("miniPitch"),
  status: document.getElementById("status"),
  matchName: document.getElementById("matchName"),
  frameReadout: document.getElementById("frameReadout"),
  eventIdInput: document.getElementById("eventIdInput"),
  eventJumpButton: document.getElementById("eventJumpButton"),
  frameSlider: document.getElementById("frameSlider"),
  frameInput: document.getElementById("frameInput"),
  jumpButton: document.getElementById("jumpButton"),
  playButton: document.getElementById("playButton"),
  backButton: document.getElementById("backButton"),
  forwardButton: document.getElementById("forwardButton"),
  speedSelect: document.getElementById("speedSelect"),
  labelsToggle: document.getElementById("labelsToggle"),
  eventsToggle: document.getElementById("eventsToggle"),
  axesToggle: document.getElementById("axesToggle"),
  eventList: document.getElementById("eventList"),
  inspector: document.getElementById("inspector"),
};

window.addEventListener("error", (event) => {
  setStatus(`Error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason?.message || event.reason || "Unhandled promise rejection";
  setStatus(`Error: ${reason}`);
});

const state = {
  match: null,
  frame: null,
  currentFrameNumber: null,
  playing: false,
  playTimer: null,
  queue: [],
  selected: null,
  bodyConnections: [],
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  skeletonGroup: null,
  pitchGroup: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
};

const materials = {
  home: new THREE.MeshStandardMaterial({ color: 0xe04444, roughness: 0.52 }),
  away: new THREE.MeshStandardMaterial({ color: 0x6bb7ff, roughness: 0.52 }),
  referee: new THREE.MeshStandardMaterial({ color: 0xd8d35f, roughness: 0.52 }),
  selected: new THREE.MeshStandardMaterial({ color: 0x7cd992, emissive: 0x1f5a2f, roughness: 0.4 }),
  joint: new THREE.MeshStandardMaterial({ color: 0x76d487, roughness: 0.44 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xf2b84b, roughness: 0.38 }),
  boneHome: new THREE.MeshStandardMaterial({ color: 0xe86666, roughness: 0.5 }),
  boneAway: new THREE.MeshStandardMaterial({ color: 0x8bc8ff, roughness: 0.5 }),
  boneReferee: new THREE.MeshStandardMaterial({ color: 0xd8d35f, roughness: 0.5 }),
  axis: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
};

const jointGeometry = new THREE.SphereGeometry(0.09, 10, 10);
const ballGeometry = new THREE.SphereGeometry(0.16, 18, 18);

init().catch((error) => {
  setStatus(error.message);
  console.error(error);
});

async function init() {
  setupScene();
  bindControls();
  const match = await fetchJson("/api/match");
  state.match = match;
  state.bodyConnections = match.bodyConnections;
  dom.matchName.textContent = match.matchFolder.replace("_", " ");
  configureSlider(match);
  await loadFrame(match.defaultFrame);
  animate();
}

function setupScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x0c0c0b);
  state.camera = new THREE.PerspectiveCamera(48, dom.scene.clientWidth / dom.scene.clientHeight, 0.1, 1000);
  state.camera.position.set(0, 44, 68);

  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(dom.scene.clientWidth, dom.scene.clientHeight);
  dom.scene.appendChild(state.renderer.domElement);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.target.set(0, 0, 0);
  state.controls.enableDamping = true;
  state.controls.maxPolarAngle = Math.PI * 0.49;
  state.controls.minDistance = 16;
  state.controls.maxDistance = 140;

  const ambient = new THREE.HemisphereLight(0xffffff, 0x2f2b23, 2.0);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(18, 38, 12);
  state.scene.add(ambient, key);

  state.pitchGroup = new THREE.Group();
  state.skeletonGroup = new THREE.Group();
  state.scene.add(state.pitchGroup, state.skeletonGroup);
  drawPitch3d();

  window.addEventListener("resize", resizeRenderer);
  state.renderer.domElement.addEventListener("pointerdown", handlePointerDown);
}

function bindControls() {
  dom.jumpButton.addEventListener("click", () => loadFrame(Number(dom.frameInput.value)));
  dom.eventJumpButton.addEventListener("click", jumpToEventId);
  dom.eventIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      jumpToEventId();
    }
  });
  dom.frameSlider.addEventListener("change", () => loadFrame(Number(dom.frameSlider.value)));
  dom.backButton.addEventListener("click", () => loadFrame((state.currentFrameNumber ?? 0) - 50));
  dom.forwardButton.addEventListener("click", () => loadFrame((state.currentFrameNumber ?? 0) + 50));
  dom.playButton.addEventListener("click", togglePlayback);
  dom.labelsToggle.addEventListener("change", () => renderFrame(state.frame));
  dom.axesToggle.addEventListener("change", () => renderFrame(state.frame));
  dom.eventsToggle.addEventListener("change", () => {
    renderEvents(state.frame?.events ?? []);
    drawMiniPitch();
  });
}

function configureSlider(match) {
  dom.frameSlider.min = String(match.frameRange.start);
  dom.frameSlider.max = String(match.frameRange.end);
  dom.frameSlider.value = String(match.defaultFrame);
  dom.frameInput.value = String(match.defaultFrame);
}

async function loadFrame(frameNumber) {
  stopPlayback();
  setStatus(`Loading frame ${frameNumber}`);
  const payload = await fetchJson(`/api/frame?frame=${encodeURIComponent(frameNumber)}`);
  if (!payload.frame) {
    setStatus(payload.error || "No frame found");
    return;
  }
  setFrame(payload.frame);
  setStatus(`${payload.matchFolder} frame ${payload.frame.frameNumber} (${payload.cache})`);
}

async function jumpToEventId() {
  const eventId = dom.eventIdInput.value.trim();
  if (!eventId) {
    setStatus("Enter an event ID first");
    return;
  }
  stopPlayback();
  setStatus(`Resolving event ${eventId}`);
  const payload = await fetchJson(`/api/event?eventId=${encodeURIComponent(eventId)}`);
  if (payload.frame == null) {
    setStatus(`Event ${eventId} has no mapped skeleton frame`);
    renderInspector({ type: "event", event: payload.event });
    return;
  }
  await loadFrame(Number(payload.frame));
  renderInspector({ type: "event", event: payload.event });
  setStatus(`Jumped to ${payload.event.type} ${eventId} at frame ${payload.frame}`);
}

function setFrame(frame) {
  state.frame = frame;
  state.currentFrameNumber = frame.frameNumber;
  dom.frameReadout.textContent = `Frame ${frame.frameNumber}`;
  dom.frameSlider.value = String(frame.frameNumber);
  dom.frameInput.value = String(frame.frameNumber);
  renderFrame(frame);
  renderEvents(frame.events ?? []);
  renderInspector(state.selected || { type: "frame", frame });
  drawMiniPitch();
}

async function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  state.playing = true;
  dom.playButton.textContent = "Pause";
  if (!state.queue.length) {
    await loadQueue();
  }
  const speed = Number(dom.speedSelect.value);
  state.playTimer = window.setInterval(async () => {
    if (!state.queue.length) {
      await loadQueue();
    }
    const next = state.queue.shift();
    if (next) {
      setFrame(next);
    }
  }, Math.max(20, 1000 / (25 * speed)));
}

function stopPlayback() {
  if (state.playTimer) {
    window.clearInterval(state.playTimer);
  }
  state.playTimer = null;
  state.playing = false;
  dom.playButton.textContent = "Play";
}

async function loadQueue() {
  const start = (state.currentFrameNumber ?? state.match.defaultFrame) + 2;
  const end = start + 118;
  setStatus(`Preloading ${start}-${end}`);
  const payload = await fetchJson(`/api/chunk?startFrame=${start}&endFrame=${end}&stride=2`);
  state.queue = payload.frames ?? [];
  setStatus(`Loaded ${state.queue.length} playback frames`);
}

function renderFrame(frame) {
  clearGroup(state.skeletonGroup);
  if (!frame) return;

  if (frame.ball?.position) {
    const ball = new THREE.Mesh(ballGeometry, materials.ball);
    ball.position.copy(toThree(frame.ball.position));
    ball.userData = { type: "ball", ball: frame.ball, frameNumber: frame.frameNumber };
    state.skeletonGroup.add(ball);
  }

  for (const player of frame.players) {
    renderPlayer(player, frame.frameNumber);
  }
}

function renderPlayer(player, frameNumber) {
  const group = new THREE.Group();
  group.userData = { type: "player", player, frameNumber };
  const boneMaterial = boneMaterialFor(player);
  const jointMaterial = state.selected?.player?.personId === player.personId ? materials.selected : materials.joint;

  for (const connection of state.bodyConnections) {
    const a = player.parts[connection.from];
    const b = player.parts[connection.to];
    if (a && b) {
      group.add(cylinderBetween(toThree(a), toThree(b), 0.035, boneMaterial));
    }
  }

  for (const [partName, point] of Object.entries(player.parts)) {
    const joint = new THREE.Mesh(jointGeometry, jointMaterial);
    joint.position.copy(toThree(point));
    joint.userData = { type: "joint", player, partName, point, frameNumber };
    group.add(joint);
  }

  if (dom.axesToggle.checked) {
    addAxisLine(group, player.parts.pelvis, player.headDirection, 0x7cd992, 0.85);
    addAxisLine(group, player.parts.pelvis, player.shoulderAxis, 0xffffff, 0.65);
    addAxisLine(group, player.parts.pelvis, player.hipAxis, 0xf2b84b, 0.65);
  }

  if (dom.labelsToggle.checked && player.parts.neck) {
    const label = makeLabel(`${player.jerseyNumber} ${player.name}`);
    label.position.copy(toThree(player.parts.neck));
    label.position.y += 0.8;
    group.add(label);
  }

  state.skeletonGroup.add(group);
}

function drawPitch3d() {
  const length = 105;
  const width = 68;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(length, width),
    new THREE.MeshStandardMaterial({ color: 0x285f3f, roughness: 0.9 })
  );
  plane.rotation.x = -Math.PI / 2;
  state.pitchGroup.add(plane);

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe9efe5, transparent: true, opacity: 0.78 });
  addRectLine(-length / 2, -width / 2, length, width, lineMaterial);
  addLine([0, 0, -width / 2], [0, 0, width / 2], lineMaterial);
  addCircle(0, 0, 9.15, lineMaterial);
  addRectLine(-length / 2, -20.16, 16.5, 40.32, lineMaterial);
  addRectLine(length / 2 - 16.5, -20.16, 16.5, 40.32, lineMaterial);
  addRectLine(-length / 2, -9.16, 5.5, 18.32, lineMaterial);
  addRectLine(length / 2 - 5.5, -9.16, 5.5, 18.32, lineMaterial);
}

function drawMiniPitch() {
  const canvas = dom.miniPitch;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#17482d";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(242,239,231,0.78)";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.beginPath();
  ctx.moveTo(w / 2, 10);
  ctx.lineTo(w / 2, h - 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 34, 0, Math.PI * 2);
  ctx.stroke();

  if (!state.frame) return;
  if (dom.eventsToggle.checked) {
    for (const event of state.frame.events ?? []) {
      if (event.x == null || event.y == null) continue;
      const p = toMini({ x: event.x, y: event.y });
      ctx.fillStyle = "#f2b84b";
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
  }
  for (const player of state.frame.players) {
    const pelvis = player.parts.pelvis;
    if (!pelvis) continue;
    const p = toMini(pelvis);
    ctx.fillStyle = colorForPlayer(player);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (player.headDirection) {
      ctx.strokeStyle = "#f2efe7";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + player.headDirection.x * 10, p.y - player.headDirection.y * 10);
      ctx.stroke();
    }
  }
}

function renderEvents(events) {
  dom.eventList.innerHTML = "";
  if (!dom.eventsToggle.checked) {
    dom.eventList.textContent = "Hidden";
    return;
  }
  if (!events.length) {
    dom.eventList.textContent = "No nearby events";
    return;
  }
  for (const event of events.slice(0, 20)) {
    const button = document.createElement("button");
    button.className = "event-button";
    button.type = "button";
    button.innerHTML = `<span class="event-type">${escapeHtml(event.type)}</span><span class="event-meta">${escapeHtml(
      [event.playerName, event.teamName, event.skeletonFrame].filter(Boolean).join(" | ")
    )}</span>`;
    button.addEventListener("click", () => {
      dom.eventIdInput.value = event.eventId || "";
      renderInspector({ type: "event", event });
    });
    dom.eventList.appendChild(button);
  }
}

function renderInspector(selection) {
  state.selected = selection;
  const rows = [];
  if (!selection) {
    rows.push(["Selection", "None"]);
  } else if (selection.type === "joint") {
    rows.push(["Type", "Body joint"]);
    rows.push(["Player", selection.player.name]);
    rows.push(["Part", selection.partName]);
    rows.push(["Frame", selection.frameNumber]);
    rows.push(["Position", formatVec(selection.point)]);
  } else if (selection.type === "player") {
    const p = selection.player;
    rows.push(["Type", "Player"]);
    rows.push(["Name", p.name]);
    rows.push(["Team", p.teamName]);
    rows.push(["Jersey", p.jerseyNumber]);
    rows.push(["Person ID", p.personId || "-"]);
    rows.push(["Position", p.playingPosition || "-"]);
    rows.push(["Pelvis", p.parts.pelvis ? formatVec(p.parts.pelvis) : "-"]);
    rows.push(["Speed", p.pelvisSpeed == null ? "-" : `${p.pelvisSpeed.toFixed(2)} m/s`]);
    rows.push(["Ball distance", p.nearestBallDistance == null ? "-" : `${p.nearestBallDistance.toFixed(2)} m`]);
  } else if (selection.type === "ball") {
    rows.push(["Type", "Ball"]);
    rows.push(["Frame", selection.frameNumber]);
    rows.push(["Position", formatVec(selection.ball.position)]);
    rows.push(["Velocity", selection.ball.velocity ? formatVec(selection.ball.velocity) : "-"]);
  } else if (selection.type === "event") {
    const e = selection.event;
    rows.push(["Type", e.type]);
    rows.push(["Event ID", e.eventId || "-"]);
    rows.push(["Player", e.playerName || "-"]);
    rows.push(["Team", e.teamName || "-"]);
    rows.push(["KPI frame", e.kpiFrame]);
    rows.push(["Skeleton", e.skeletonFrame]);
    for (const [key, value] of Object.entries(e.attributes || {}).slice(0, 14)) {
      rows.push([key, value]);
    }
  } else if (selection.type === "frame") {
    rows.push(["Type", "Frame"]);
    rows.push(["Frame", selection.frame.frameNumber]);
    rows.push(["Players", selection.frame.players.length]);
    rows.push(["Events", selection.frame.events?.length ?? 0]);
  }
  dom.inspector.innerHTML = rows.map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></div>`).join("");
  renderFrame(state.frame);
}

function handlePointerDown(event) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const hits = state.raycaster.intersectObjects(state.skeletonGroup.children, true);
  if (hits.length) {
    const data = hits[0].object.userData;
    if (data.type === "joint") {
      renderInspector(data);
    } else if (data.type === "ball") {
      renderInspector(data);
    } else {
      let parent = hits[0].object.parent;
      while (parent && !parent.userData?.player) parent = parent.parent;
      if (parent?.userData?.player) {
        renderInspector(parent.userData);
      }
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

function resizeRenderer() {
  const width = dom.scene.clientWidth;
  const height = dom.scene.clientHeight;
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

function toThree(point) {
  return new THREE.Vector3(point.x, point.z ?? 0, -point.y);
}

function toMini(point) {
  const w = dom.miniPitch.width;
  const h = dom.miniPitch.height;
  return {
    x: 10 + ((point.x + 52.5) / 105) * (w - 20),
    y: 10 + ((34 - point.y) / 68) * (h - 20),
  };
}

function cylinderBetween(start, end, radius, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addAxisLine(group, origin, direction, color, length) {
  if (!origin || !direction) return;
  const start = toThree(origin);
  const end = start.clone().add(new THREE.Vector3(direction.x * length, 0, -direction.y * length));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), material);
  group.add(line);
}

function addLine(a, b, material) {
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], a[1] + 0.015, a[2]), new THREE.Vector3(b[0], b[1] + 0.015, b[2])]), material));
}

function addRectLine(x, z, width, height, material) {
  const y = 0.02;
  const points = [
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(x + width, y, z),
    new THREE.Vector3(x + width, y, z + height),
    new THREE.Vector3(x, y, z + height),
    new THREE.Vector3(x, y, z),
  ];
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}

function addCircle(x, z, radius, material) {
  const points = [];
  for (let i = 0; i <= 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, 0.025, z + Math.sin(angle) * radius));
  }
  state.pitchGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}

function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(17,17,17,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f2efe7";
  ctx.font = "24px sans-serif";
  ctx.fillText(text.slice(0, 22), 12, 40);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.8, 0.7, 1);
  return sprite;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
  }
}

function boneMaterialFor(player) {
  if (player.teamCode === 1) return materials.boneHome;
  if (player.teamCode === 0) return materials.boneAway;
  return materials.boneReferee;
}

function colorForPlayer(player) {
  if (player.teamCode === 1) return "#e04444";
  if (player.teamCode === 0) return "#6bb7ff";
  return "#d8d35f";
}

function formatVec(vec) {
  return `${Number(vec.x).toFixed(2)}, ${Number(vec.y).toFixed(2)}, ${Number(vec.z ?? 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function setStatus(message) {
  dom.status.textContent = message;
}
