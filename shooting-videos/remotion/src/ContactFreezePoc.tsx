/**
 * Contact-Freeze POC (~6 s, 180 frames @ 30 fps)
 *
 * Implements AGY's #1 highest-leverage recommendation from the head-to-head
 * comparison report (derived/agy-comparison-report.md, Section F):
 *
 *   Run-up @ 100% real-time
 *     → instant 0% freeze at the contact frame
 *     → 60-frame cubic-ease 95° polar orbit around the contact point
 *     → annotations choreographed 1–2 at a time
 *       (distance ruler → angle arc → velocity arrow)
 *     → slow-mo follow-through
 *     → fade-out
 *
 * This is a standalone proof-of-concept. Once we lock the choreography here we
 * port the pattern back into PhaseSegment components for P2/P4/P5.
 *
 * Reads from public/explainer-pair.json (Bahoya shot 18905200000743). Annotations
 * are anchored to projected 3D screen positions so they "stick" to the body as
 * the camera orbits.
 */
import {ThreeCanvas} from "@remotion/three";
import {useThree} from "@react-three/fiber";
import React, {useLayoutEffect, useMemo} from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import * as THREE from "three";
import explainerPair from "../public/explainer-pair.json";
import {palette, type, typeScale} from "./style/tokens";
import {AngleArc, DistanceRule, FilterDefs, VelocityArrow, type ScreenPoint} from "./primitives";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */
type Vec3 = {x: number; y: number; z: number};
type Ball = {position?: Vec3; velocity?: Vec3};
type Player = {
  name?: string;
  jerseyNumber?: number | string;
  teamCode?: number;
  parts: Record<string, Vec3>;
};
type ShotFrame = {frameNumber: number; ball?: Ball | null; players?: Player[]};
type Clip = {
  role: string;
  shot: {player?: string; team?: string};
  features: Record<string, string | number | null>;
  score: Record<string, string | number | null>;
  frames: ShotFrame[];
};
type ExplainerData = {clips: Clip[]};
const data = explainerPair as unknown as ExplainerData;
const clip = data.clips[0];

/* -------------------------------------------------------------------------- */
/* Tracab → Three.js coordinate mapping (consistent with existing scene code)  */
/* -------------------------------------------------------------------------- */
const toThree = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.z, -p.y);

/* -------------------------------------------------------------------------- */
/* Choreography constants                                                      */
/* -------------------------------------------------------------------------- */
const TOTAL_FRAMES = 180; // 6 s @ 30 fps
const F_IMPACT = 30; //   render frame at which contact happens (1 s run-up)
const F_ORBIT_END = 90; // run-up + 60-frame freeze orbit (3 s total)
const F_FOLLOW_END = 150; // + 60-frame slow-mo follow-through (5 s total)
// 150 – 180: 1 s outro

// Annotation sub-windows during the freeze orbit (relative to render frame)
const A1_DRAW_IN = 36; // distance ruler starts drawing
const A1_HOLD_END = 60; // distance ruler fades out
const A2_DRAW_IN = 56; // angle arc starts drawing
const A2_HOLD_END = 78; // angle arc fades out
const A3_DRAW_IN = 70; // velocity arrow starts drawing
const A3_HOLD_END = 90; // velocity arrow held through end of freeze

const DRAW_ON_FRAMES = 10; // AGY-spec snappy draw-on
const FADE_OUT_FRAMES = 5;

// Polar camera angles (radians, around contact target)
const ANGLE_RUNUP_START = -0.95;
const ANGLE_RUNUP_END = -0.6;
const ANGLE_ORBIT_END = 1.05; // ~94° sweep from -0.6 (AGY spec: 90–120°)
const ANGLE_FOLLOW_END = 0.55;
const ANGLE_OUTRO_END = 0.7;

/* -------------------------------------------------------------------------- */
/* Clip-level helpers                                                          */
/* -------------------------------------------------------------------------- */
const contactFrameNumber = Number(clip.features.contact_frame);
const inferredFoot = String(clip.features.inferred_foot || "right");

const findContactIndex = (): number => {
  let bestIdx = 0;
  let bestDelta = Infinity;
  clip.frames.forEach((f, i) => {
    const d = Math.abs(f.frameNumber - contactFrameNumber);
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  });
  return bestIdx;
};
const CONTACT_IDX = findContactIndex();
const TOTAL_SRC = clip.frames.length;

const shooterIn = (frame: ShotFrame): Player | undefined =>
  (frame.players || []).find((p) => p.name === clip.shot.player);

const strikeFootKey = `${inferredFoot}_toe`;
const plantFootKey = `${inferredFoot === "right" ? "left" : "right"}_toe`;

const focusPointAt = (frame: ShotFrame): THREE.Vector3 => {
  const sh = shooterIn(frame);
  const ball = frame.ball?.position ? toThree(frame.ball.position) : null;
  const strike = sh?.parts[strikeFootKey] ? toThree(sh.parts[strikeFootKey]) : null;
  if (ball && strike) return ball.clone().lerp(strike, 0.4).add(new THREE.Vector3(0, 0.18, 0));
  if (ball) return ball.clone().add(new THREE.Vector3(0, 0.3, 0));
  if (sh?.parts.pelvis) return toThree(sh.parts.pelvis);
  return new THREE.Vector3(0, 1, 0);
};

/* -------------------------------------------------------------------------- */
/* Frame mapping — run-up real time, freeze, slow-mo follow                    */
/* -------------------------------------------------------------------------- */
function sourceIndexForRenderFrame(rf: number): number {
  if (rf <= F_IMPACT) {
    // 50 source frames @ 50 fps over 30 render frames @ 30 fps = real time
    const t = rf / F_IMPACT;
    return Math.min(CONTACT_IDX, Math.round(t * CONTACT_IDX));
  }
  if (rf <= F_ORBIT_END) {
    return CONTACT_IDX; // FREEZE
  }
  if (rf <= F_FOLLOW_END) {
    // 60 render frames cover ~30 source frames = 0.5x slow-mo
    const t = (rf - F_ORBIT_END) / (F_FOLLOW_END - F_ORBIT_END);
    const sourceOffset = Math.round(t * 30);
    return Math.min(TOTAL_SRC - 1, CONTACT_IDX + sourceOffset);
  }
  return Math.min(TOTAL_SRC - 1, CONTACT_IDX + 30);
}

/* -------------------------------------------------------------------------- */
/* Camera choreography                                                         */
/* -------------------------------------------------------------------------- */
type CameraState = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
};

function cameraForRenderFrame(
  rf: number,
  contactTarget: THREE.Vector3,
  liveTarget: THREE.Vector3,
): CameraState {
  let target = contactTarget.clone();
  let angle = 0;
  let radius = 5;
  let height = 2.0;
  let fov = 32;

  if (rf <= F_IMPACT) {
    // Run-up — handheld-ish glide tracking the live shooter
    target = liveTarget.clone();
    const t = rf / F_IMPACT;
    angle = interpolate(t, [0, 1], [ANGLE_RUNUP_START, ANGLE_RUNUP_END]);
    radius = interpolate(t, [0, 1], [6.5, 4.2]);
    height = interpolate(t, [0, 1], [2.7, 1.95]);
    fov = interpolate(t, [0, 1], [36, 30]);
  } else if (rf <= F_ORBIT_END) {
    // Freeze + cubic-eased 94° polar orbit around contact
    target = contactTarget.clone();
    const t = (rf - F_IMPACT) / (F_ORBIT_END - F_IMPACT);
    const eased = Easing.out(Easing.cubic)(t);
    angle = interpolate(eased, [0, 1], [ANGLE_RUNUP_END, ANGLE_ORBIT_END]);
    radius = interpolate(eased, [0, 1], [4.2, 3.4]);
    height = interpolate(eased, [0, 1], [1.95, 1.55]);
    fov = interpolate(eased, [0, 1], [30, 27]);
  } else if (rf <= F_FOLLOW_END) {
    // Slow-mo follow — drift back & lift
    target = contactTarget.clone().lerp(liveTarget, 0.25);
    const t = (rf - F_ORBIT_END) / (F_FOLLOW_END - F_ORBIT_END);
    const eased = Easing.inOut(Easing.cubic)(t);
    angle = interpolate(eased, [0, 1], [ANGLE_ORBIT_END, ANGLE_FOLLOW_END]);
    radius = interpolate(eased, [0, 1], [3.4, 5.0]);
    height = interpolate(eased, [0, 1], [1.55, 2.2]);
    fov = interpolate(eased, [0, 1], [27, 32]);
  } else {
    // Outro drift
    target = contactTarget.clone();
    const t = (rf - F_FOLLOW_END) / (TOTAL_FRAMES - F_FOLLOW_END);
    angle = interpolate(t, [0, 1], [ANGLE_FOLLOW_END, ANGLE_OUTRO_END]);
    radius = interpolate(t, [0, 1], [5.0, 5.7]);
    height = interpolate(t, [0, 1], [2.2, 2.5]);
    fov = 33;
  }

  return {
    position: new THREE.Vector3(
      target.x + Math.cos(angle) * radius,
      target.y + height,
      target.z + Math.sin(angle) * radius,
    ),
    target,
    fov,
  };
}

/* -------------------------------------------------------------------------- */
/* 3D-to-screen projection (matches in-scene camera state)                     */
/* -------------------------------------------------------------------------- */
function projectScreen(
  world: THREE.Vector3,
  cam: CameraState,
  width: number,
  height: number,
): {x: number; y: number; visible: boolean} {
  const camObj = new THREE.PerspectiveCamera(cam.fov, width / height, 0.1, 100);
  camObj.position.copy(cam.position);
  camObj.lookAt(cam.target);
  camObj.updateMatrixWorld(true);
  camObj.updateProjectionMatrix();
  const v = world.clone().project(camObj);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (1 - (v.y * 0.5 + 0.5)) * height,
    visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 2 && Math.abs(v.y) < 2,
  };
}

/* -------------------------------------------------------------------------- */
/* Body skeleton lines (subset of full 21-joint set for cleanliness)           */
/* -------------------------------------------------------------------------- */
const BONES: ReadonlyArray<readonly [string, string]> = [
  ["nose", "neck"],
  ["neck", "left_shoulder"],
  ["neck", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["neck", "pelvis"],
  ["pelvis", "left_hip"],
  ["pelvis", "right_hip"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_toe"],
  ["left_ankle", "left_heel"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_toe"],
  ["right_ankle", "right_heel"],
];

const JOINTS_TO_RENDER = [
  "nose",
  "neck",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "pelvis",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_toe",
  "right_toe",
  "left_heel",
  "right_heel",
];

/* -------------------------------------------------------------------------- */
/* 3D scene                                                                    */
/* -------------------------------------------------------------------------- */
const Scene: React.FC<{
  frame: ShotFrame;
  cam: CameraState;
  isShooter: (p: Player) => boolean;
}> = ({frame, cam, isShooter}) => {
  return (
    <>
      {/* Ambient + key + fill — matches AGY's "cinematic lab" character but cleaner */}
      <color attach="background" args={["#06090f"]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#cfe6ff", "#04060a", 0.9]} />
      <directionalLight position={[8, 14, -6]} intensity={2.0} color="#eaf2fa" />
      <directionalLight position={[-9, 9, 7]} intensity={1.1} color="#5ee7ff" />

      <PerspectiveCamera cam={cam} />

      {/* Ground — desaturated dark turf, no debug grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 80]} />
        <meshStandardMaterial color="#102018" roughness={0.95} metalness={0.0} />
      </mesh>
      {/* Soft turf vignette circle around the action */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[6, 12, 64]} />
        <meshBasicMaterial color="#0a0e12" transparent opacity={0.55} />
      </mesh>
      {/* Center dot at the contact point (subtle ground reference) */}
      {frame.ball?.position ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[frame.ball.position.x, 0.002, -frame.ball.position.y]}>
          <ringGeometry args={[0.18, 0.22, 48]} />
          <meshBasicMaterial color="#5ee7ff" transparent opacity={0.55} />
        </mesh>
      ) : null}

      {/* Players */}
      {(frame.players || []).map((p, i) => (
        <Skeleton key={i} player={p} isShooter={isShooter(p)} />
      ))}

      {/* Ball */}
      {frame.ball?.position ? (
        <group position={[frame.ball.position.x, frame.ball.position.z, -frame.ball.position.y]}>
          <mesh>
            <sphereGeometry args={[0.13, 24, 24]} />
            <meshStandardMaterial color="#fef0c8" emissive="#3d2c0a" emissiveIntensity={0.6} roughness={0.4} />
          </mesh>
        </group>
      ) : null}
    </>
  );
};

const PerspectiveCamera: React.FC<{cam: CameraState}> = ({cam}) => {
  // Imperatively configure the default camera on each frame (same pattern as
  // ShootingPhaseMechanicsCloseupA's CameraRig — known to work reliably with
  // @remotion/three's bundled @react-three/fiber).
  const {camera} = useThree();
  useLayoutEffect(() => {
    camera.position.copy(cam.position);
    camera.lookAt(cam.target);
    if ("fov" in camera) {
      (camera as THREE.PerspectiveCamera).fov = cam.fov;
    }
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
  }, [camera, cam.position, cam.target, cam.fov]);
  return null;
};

const Skeleton: React.FC<{player: Player; isShooter: boolean}> = ({player, isShooter}) => {
  const parts = player.parts || {};
  // AGY-defect #7 fix: restricted palette — shooter glowing white, others muted grey
  const boneColor = isShooter ? "#FFFFFF" : "#5a6878";
  const jointColor = isShooter ? "#FFFFFF" : "#6f7d8c";
  const emissive = isShooter ? "#9adfff" : "#000000";
  const emissiveIntensity = isShooter ? 0.55 : 0;
  const boneRadius = isShooter ? 0.018 : 0.012;
  const jointRadius = isShooter ? 0.045 : 0.028;

  return (
    <group>
      {BONES.map(([a, b], i) => {
        const pa = parts[a];
        const pb = parts[b];
        if (!pa || !pb) return null;
        const va = new THREE.Vector3(pa.x, pa.z, -pa.y);
        const vb = new THREE.Vector3(pb.x, pb.z, -pb.y);
        const mid = va.clone().add(vb).multiplyScalar(0.5);
        const len = va.distanceTo(vb);
        if (len < 0.01) return null;
        const dir = vb.clone().sub(va).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
        const angle = Math.acos(up.dot(dir));
        const quat = new THREE.Quaternion();
        if (!isNaN(axis.x) && axis.length() > 0.0001) {
          quat.setFromAxisAngle(axis, angle);
        }
        return (
          <group key={i} position={[mid.x, mid.y, mid.z]} quaternion={[quat.x, quat.y, quat.z, quat.w]}>
            <mesh>
              <cylinderGeometry args={[boneRadius, boneRadius, len, 8]} />
              <meshStandardMaterial
                color={boneColor}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.55}
                metalness={0.1}
              />
            </mesh>
          </group>
        );
      })}
      {JOINTS_TO_RENDER.map((k) => {
        const p = parts[k];
        if (!p) return null;
        return (
          <mesh key={k} position={[p.x, p.z, -p.y]}>
            <sphereGeometry args={[jointRadius, 16, 16]} />
            <meshStandardMaterial
              color={jointColor}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              roughness={0.35}
              metalness={0.15}
            />
          </mesh>
        );
      })}
    </group>
  );
};

/* -------------------------------------------------------------------------- */
/* Eyebrow + impact-flash overlay                                              */
/* -------------------------------------------------------------------------- */
const Eyebrow: React.FC<{label: string; opacity: number}> = ({label, opacity}) => (
  <div
    style={{
      position: "absolute",
      top: 44,
      left: 48,
      fontFamily: type.sans,
      fontSize: 14,
      letterSpacing: "3.4px",
      color: palette.accent.primary,
      opacity,
      textShadow: "0 1px 2px rgba(0,0,0,0.7)",
      transition: "opacity 80ms linear",
    }}
  >
    {label}
  </div>
);

const ImpactFlash: React.FC<{rf: number}> = ({rf}) => {
  // Frames 30–35: hard white flash that quickly decays
  if (rf < F_IMPACT || rf > F_IMPACT + 8) return null;
  const opacity = interpolate(rf, [F_IMPACT, F_IMPACT + 1, F_IMPACT + 8], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "white",
        opacity,
        mixBlendMode: "screen",
        pointerEvents: "none",
      }}
    />
  );
};

const Vignette: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      background: "radial-gradient(120% 90% at 50% 60%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)",
    }}
  />
);

/* -------------------------------------------------------------------------- */
/* Annotation choreography helpers                                             */
/* -------------------------------------------------------------------------- */
function annotationProgress(rf: number, drawIn: number, holdEnd: number): {progress: number; opacity: number} {
  // draw-on: drawIn .. drawIn + DRAW_ON_FRAMES — progress 0 → 1
  // hold:    drawIn + DRAW_ON_FRAMES .. holdEnd — progress 1
  // fade out: holdEnd .. holdEnd + FADE_OUT_FRAMES — opacity 1 → 0
  if (rf < drawIn) return {progress: 0, opacity: 0};
  const drawT = (rf - drawIn) / DRAW_ON_FRAMES;
  const progress = Math.min(1, Math.max(0, drawT));
  let opacity = 1;
  if (rf > holdEnd) {
    const fadeT = (rf - holdEnd) / FADE_OUT_FRAMES;
    opacity = Math.max(0, 1 - fadeT);
  }
  return {progress, opacity};
}

/* -------------------------------------------------------------------------- */
/* Verdict slate (outro)                                                       */
/* -------------------------------------------------------------------------- */
const VerdictPanel: React.FC<{opacity: number}> = ({opacity}) => {
  const score = clip.score;
  const bsq = Number(score.strike_quality_score || 0);
  const band = String(score.strike_quality_band || "ok");
  const techScore = Number(score.technique_score || 0);
  const posScore = Number(score.positioning_score || 0);
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -50%) translateY(${(1 - opacity) * 10}px) scale(${0.94 + opacity * 0.06})`,
        opacity,
        textAlign: "center",
        fontFamily: type.sans,
        color: palette.text.ink,
      }}
    >
      <div
        style={{
          fontFamily: type.sans,
          fontSize: 13,
          letterSpacing: "3.6px",
          color: palette.accent.primary,
          marginBottom: 10,
        }}
      >
        BSQ · STRIKE QUALITY
      </div>
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 180,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          color: palette.accent.primary,
          textShadow: "0 8px 36px rgba(94, 231, 255, 0.4)",
          lineHeight: 1,
        }}
      >
        {bsq.toFixed(0)}
      </div>
      <div
        style={{
          fontFamily: type.serifTitle,
          fontSize: 40,
          fontStyle: "italic",
          color: palette.text.inkSoft,
          marginTop: 4,
        }}
      >
        {band.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          gap: 24,
          justifyContent: "center",
          fontFamily: type.sans,
          fontSize: 16,
          color: palette.text.inkSoft,
        }}
      >
        <span>Technique <b style={{color: palette.band.good, fontFamily: type.mono}}>{techScore.toFixed(0)}</b></span>
        <span style={{opacity: 0.4}}>·</span>
        <span>Positioning <b style={{color: palette.band.ok, fontFamily: type.mono}}>{posScore.toFixed(0)}</b></span>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Main composition                                                            */
/* -------------------------------------------------------------------------- */
export const ContactFreezePoc: React.FC = () => {
  const rf = useCurrentFrame();
  const {width, height} = useVideoConfig();

  // Source frame for this render frame
  const srcIdx = sourceIndexForRenderFrame(rf);
  const srcFrame = clip.frames[srcIdx];
  const contactFrame = clip.frames[CONTACT_IDX];

  // Camera state
  const cam = useMemo(
    () => cameraForRenderFrame(rf, focusPointAt(contactFrame), focusPointAt(srcFrame)),
    [rf, srcFrame, contactFrame],
  );

  const isShooter = (p: Player) => p.name === clip.shot.player;
  const shooter = shooterIn(contactFrame);

  // 3D-anchored screen positions of key joints/ball at the CONTACT pose
  // (used for annotation anchors during the freeze)
  const screen = useMemo(() => {
    if (!shooter) return null;
    const ball = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : null;
    const plantToe = shooter.parts[plantFootKey] ? toThree(shooter.parts[plantFootKey]) : null;
    const strikeToe = shooter.parts[strikeFootKey] ? toThree(shooter.parts[strikeFootKey]) : null;
    const strikeAnkle = shooter.parts[`${inferredFoot}_ankle`] ? toThree(shooter.parts[`${inferredFoot}_ankle`]) : null;
    const pelvis = shooter.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
    const neck = shooter.parts.neck ? toThree(shooter.parts.neck) : null;
    const proj = (v: THREE.Vector3 | null) => (v ? projectScreen(v, cam, width, height) : null);
    return {
      ball: proj(ball),
      plantToe: proj(plantToe),
      strikeToe: proj(strikeToe),
      strikeAnkle: proj(strikeAnkle),
      pelvis: proj(pelvis),
      neck: proj(neck),
    };
  }, [shooter, contactFrame, cam, width, height]);

  // Annotation progress + opacity windows
  const a1 = annotationProgress(rf, A1_DRAW_IN, A1_HOLD_END); // distance: plant_toe → ball
  const a2 = annotationProgress(rf, A2_DRAW_IN, A2_HOLD_END); // angle: trunk lean
  const a3 = annotationProgress(rf, A3_DRAW_IN, A3_HOLD_END); // velocity: strike foot

  // Phase eyebrow label
  let eyebrow = "";
  let eyebrowOpacity = 0;
  if (rf < F_IMPACT - 4) {
    eyebrow = "P3 — RUN-UP";
    eyebrowOpacity = 0.92;
  } else if (rf < F_ORBIT_END) {
    eyebrow = "P4 — CONTACT · FREEZE";
    eyebrowOpacity = interpolate(rf, [F_IMPACT + 6, F_IMPACT + 12], [0, 0.92], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  } else if (rf < F_FOLLOW_END) {
    eyebrow = "P5 — FOLLOW-THROUGH · 0.5×";
    eyebrowOpacity = 0.92;
  } else {
    eyebrow = "BSQ — VERDICT";
    eyebrowOpacity = 0.92;
  }

  // Outro verdict opacity
  const verdictOpacity = interpolate(rf, [F_FOLLOW_END + 4, F_FOLLOW_END + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Numeric values from features for annotation labels
  const distPlantBall = Number(clip.features.plant_to_ball_xy_m ?? clip.features.C_plant_forward ?? 0.42);
  const trunkLeanDeg = 12;
  const footSpeed = Number(clip.features.foot_peak_velocity_at_contact ?? 18.3);

  return (
    <AbsoluteFill style={{background: "#06090f"}}>
      <ThreeCanvas width={width} height={height}>
        <Scene frame={srcFrame} cam={cam} isShooter={isShooter} />
      </ThreeCanvas>

      <Vignette />

      {/* SVG overlay for 2D annotations — sits ABOVE the 3D scene */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{position: "absolute", inset: 0, pointerEvents: "none"}}
      >
        <FilterDefs />

        {/* During the freeze: distance ruler (plant_toe → ball) */}
        {a1.opacity > 0 && screen?.plantToe && screen?.ball ? (
          <g opacity={a1.opacity}>
            <DistanceRule
              progress={a1.progress}
              start={screen.plantToe}
              end={screen.ball}
              value={distPlantBall.toFixed(2)}
              unit="m"
              label="plant foot → ball"
              polarity="positive"
              scale="hero"
              overshoot
              labelOffset={-26}
            />
          </g>
        ) : null}

        {/* During the freeze: angle arc (trunk lean from vertical, vertex at pelvis) */}
        {a2.opacity > 0 && screen?.pelvis && screen?.neck ? (
          <g opacity={a2.opacity}>
            <AngleArc
              progress={a2.progress}
              vertex={screen.pelvis}
              startAngleDeg={-90}
              sweepAngleDeg={trunkLeanDeg}
              radius={90}
              value={`${trunkLeanDeg}`}
              unit="deg"
              label="trunk lean from vertical"
              polarity="positive"
              scale="hero"
              filled
            />
          </g>
        ) : null}

        {/* During the freeze: velocity arrow (strike foot velocity at contact) */}
        {a3.opacity > 0 && screen?.strikeAnkle && screen?.strikeToe ? (
          <g opacity={a3.opacity}>
            <VelocityArrow
              progress={a3.progress}
              uid="cfp-vel"
              start={screen.strikeAnkle}
              end={screen.strikeToe}
              value={footSpeed.toFixed(1)}
              unit="m/s"
              label="strike foot velocity"
              polarity="positive"
              scale="hero"
            />
          </g>
        ) : null}
      </svg>

      <ImpactFlash rf={rf} />
      <Eyebrow label={eyebrow} opacity={eyebrowOpacity} />
      {verdictOpacity > 0 ? <VerdictPanel opacity={verdictOpacity} /> : null}
    </AbsoluteFill>
  );
};
