import {ThreeCanvas} from "@remotion/three";
import {useThree} from "@react-three/fiber";
import React, {useLayoutEffect, useMemo} from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import * as THREE from "three";
import explainerPair from "../public/explainer-pair.json";

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
  role: "standout" | "constraint";
  matchFolder: string;
  eventId: string;
  shot: {player?: string; team?: string};
  score: Record<string, string | number | null>;
  features: Record<string, string | number | null>;
  frameRoles: {contactFrame?: number; physicsExitFrame?: number};
  frameWindow: {start: number; end: number; contact?: number};
  frames: ShotFrame[];
};
type ExplainerData = {clips: Clip[]};

const data = explainerPair as unknown as ExplainerData;

const BODY_CONNECTIONS = [
  ["nose", "neck"],
  ["neck", "left_shoulder"],
  ["neck", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["neck", "pelvis"],
  ["left_hip", "pelvis"],
  ["right_hip", "pelvis"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_heel"],
  ["left_ankle", "left_toe"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_ankle", "right_toe"],
] as const;

const WHITE = "#f6f3ea";
const ACCENT_BLUE = "#2f7dff";
const DEEP_BLUE = "#082456";
const ICE_BLUE = "#8fd8ff";
const BLACK = "#090a09";
const BALL = "#fff2df";
const CYAN = "#65e9ff";
const LINE = "rgba(255,255,255,0.82)";

const DURATION = 720;
const MACRO_START = 70;
const METRIC_START = 245;
const GOAL_START = 455;

export const HudlStyleExplainer = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const clip = data.clips[0];
  const mode = frame < GOAL_START ? "macro" : "goal";
  const shotFrame = useMemo(() => frameForHudl(clip, frame), [clip, frame]);
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(() => cameraForHudl(clip, mode, shotFrame, contactFrame, frame), [clip, contactFrame, frame, mode, shotFrame]);

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={[mode === "macro" ? "#080603" : "#07110b"]} />
        <ambientLight intensity={mode === "macro" ? 0.85 : 0.95} />
        <hemisphereLight args={["#fff7ec", "#251100", mode === "macro" ? 1.25 : 0.9]} />
        <directionalLight position={[8, 8, 6]} intensity={mode === "macro" ? 3.3 : 1.9} />
        <directionalLight position={[-8, 5, -8]} intensity={mode === "macro" ? 1.3 : 0.6} color={ACCENT_BLUE} />
        <CameraRig position={camera.position} target={camera.target} fov={camera.fov} />
        {mode === "macro" ? (
          <MacroWorld clip={clip} shotFrame={shotFrame} contactFrame={contactFrame} frame={frame} />
        ) : (
          <GoalWorld clip={clip} shotFrame={shotFrame} contactFrame={contactFrame} frame={frame} />
        )}
      </ThreeCanvas>
      <HudlAtmosphere mode={mode} />
      <HudlOverlay clip={clip} frame={frame} mode={mode} />
    </AbsoluteFill>
  );
};

const MacroWorld: React.FC<{clip: Clip; shotFrame: ShotFrame; contactFrame: ShotFrame; frame: number}> = ({
  clip,
  shotFrame,
  contactFrame,
  frame,
}) => {
  const player = (shotFrame.players || []).find((item) => item.name === clip.shot.player);
  const contactPlayer = (contactFrame.players || []).find((item) => item.name === clip.shot.player);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;
  const metricProgress = eased(frame, METRIC_START, GOAL_START - 70);
  const focus = contactBall || ball || new THREE.Vector3(0, 0, 0);

  return (
    <group>
      <StudioFloor focus={focus} />
      {contactPlayer ? <ContactShadow player={contactPlayer} /> : null}
      {player ? <StylizedPlayer player={player} clip={clip} /> : null}
      {ball ? <CinematicBall position={ball} /> : null}
      {contactBall ? <ContactSpark position={contactBall} progress={eased(frame, MACRO_START, METRIC_START)} /> : null}
      {contactPlayer && contactBall ? <MacroMeasurements clip={clip} player={contactPlayer} ball={contactBall} progress={metricProgress} /> : null}
    </group>
  );
};

const GoalWorld: React.FC<{clip: Clip; shotFrame: ShotFrame; contactFrame: ShotFrame; frame: number}> = ({
  clip,
  shotFrame,
  contactFrame,
  frame,
}) => {
  const shooterName = clip.shot.player;
  const shooter = (contactFrame.players || []).find((player) => player.name === shooterName);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const pathProgress = eased(frame, GOAL_START, DURATION - 80);

  return (
    <group>
      <PitchScene />
      <GoalFrame />
      <KeeperGhost />
      {(contactFrame.players || []).slice(0, 8).map((player, index) => (
        player.name === shooterName ? null : <DistantPlayer key={`${player.name}-${index}`} player={player} />
      ))}
      {shooter ? <StylizedPlayer player={shooter} clip={clip} compact /> : null}
      <ReleasePath clip={clip} progress={pathProgress} />
      {ball ? <CinematicBall position={ball} /> : null}
    </group>
  );
};

const StylizedPlayer: React.FC<{player: Player; clip: Clip; compact?: boolean}> = ({player, clip, compact = false}) => {
  const strikeFoot = String(clip.features.inferred_foot || "right");
  const plantFoot = String(clip.features.plant_foot || "left");
  const head = player.parts.nose ? toThree(player.parts.nose).add(new THREE.Vector3(0, 0.16, 0)) : null;
  return (
    <group>
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        const isFoot = from.startsWith(strikeFoot) || to.startsWith(strikeFoot) || from.startsWith(plantFoot) || to.startsWith(plantFoot);
        const isTorso = [from, to].includes("neck") || [from, to].includes("pelvis");
        return (
          <CylinderBetween
            key={`${from}-${to}`}
            start={toThree(a)}
            end={toThree(b)}
            radius={compact ? 0.038 : isTorso ? 0.074 : 0.052}
            color={isFoot ? ACCENT_BLUE : WHITE}
            opacity={0.98}
          />
        );
      })}
      {Object.entries(player.parts).map(([name, point]) => {
        const isBoot = name.endsWith("_toe") || name.endsWith("_heel");
        const isKnee = name.endsWith("_knee");
        const isHand = name.endsWith("_wrist");
        const color = isBoot ? ACCENT_BLUE : isKnee || isHand ? "#181818" : WHITE;
        const radius = compact ? 0.064 : isBoot ? 0.105 : isKnee || isHand ? 0.088 : 0.078;
        return (
          <mesh key={name} position={toThree(point)}>
            <sphereGeometry args={[radius, 18, 18]} />
            <meshStandardMaterial color={color} roughness={0.32} metalness={0.05} emissive={isBoot ? "#06183a" : "#000000"} />
          </mesh>
        );
      })}
      {head ? (
        <mesh position={head}>
          <sphereGeometry args={[compact ? 0.13 : 0.17, 24, 24]} />
          <meshStandardMaterial color="#171717" roughness={0.24} metalness={0.14} />
        </mesh>
      ) : null}
      {strikeFootPoint(clip, player) ? <FootGlow point={strikeFootPoint(clip, player)!} /> : null}
    </group>
  );
};

const MacroMeasurements: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({clip, player, ball, progress}) => {
  const strike = strikeFootPoint(clip, player);
  const plant = plantFootPoint(clip, player);
  const leftShoulder = player.parts.left_shoulder ? toThree(player.parts.left_shoulder) : null;
  const rightShoulder = player.parts.right_shoulder ? toThree(player.parts.right_shoulder) : null;
  const leftHip = player.parts.left_hip ? toThree(player.parts.left_hip) : null;
  const rightHip = player.parts.right_hip ? toThree(player.parts.right_hip) : null;
  const shoulderProgress = Math.max(0, Math.min(1, (progress - 0.45) / 0.35));
  return (
    <group>
      {strike ? <AnimatedCylinder start={strike} end={ball} color="#ffffff" progress={Math.min(1, progress * 1.6)} radius={0.018} /> : null}
      {plant ? <RaisedRuler start={new THREE.Vector3(plant.x, 0.1, plant.z)} end={new THREE.Vector3(ball.x, 0.1, ball.z)} progress={progress} /> : null}
      {leftShoulder && rightShoulder ? <AnimatedCylinder start={leftShoulder} end={rightShoulder} color={CYAN} progress={shoulderProgress} radius={0.026} /> : null}
      {leftHip && rightHip ? <AnimatedCylinder start={leftHip} end={rightHip} color={ICE_BLUE} progress={shoulderProgress} radius={0.03} /> : null}
      {leftShoulder && rightShoulder && leftHip && rightHip ? (
        <RotationArc shoulderA={leftShoulder} shoulderB={rightShoulder} hipA={leftHip} hipB={rightHip} progress={shoulderProgress} />
      ) : null}
    </group>
  );
};

const RaisedRuler: React.FC<{start: THREE.Vector3; end: THREE.Vector3; progress: number}> = ({start, end, progress}) => {
  const lift = new THREE.Vector3(0, 0.34, 0);
  const a = start.clone().add(lift);
  const b = end.clone().add(lift);
  const current = a.clone().lerp(b, Math.max(0, Math.min(1, progress)));
  return (
    <group>
      <CylinderBetween start={start} end={a} radius={0.014} color="#ffffff" opacity={0.75} />
      {progress > 0.7 ? <CylinderBetween start={end} end={b} radius={0.014} color="#ffffff" opacity={0.75} /> : null}
      <CylinderBetween start={a} end={current} radius={0.026} color="#ffffff" opacity={0.96} />
      <mesh position={a}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={current}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
};

const RotationArc: React.FC<{
  shoulderA: THREE.Vector3;
  shoulderB: THREE.Vector3;
  hipA: THREE.Vector3;
  hipB: THREE.Vector3;
  progress: number;
}> = ({shoulderA, shoulderB, hipA, hipB, progress}) => {
  const center = hipA.clone().lerp(hipB, 0.5).add(new THREE.Vector3(0, 0.48, 0));
  const points = useMemo(() => {
    const start = Math.atan2(hipB.z - hipA.z, hipB.x - hipA.x);
    const end = Math.atan2(shoulderB.z - shoulderA.z, shoulderB.x - shoulderA.x);
    let delta = end - start;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const count = Math.max(2, Math.round(32 * Math.max(0, Math.min(1, progress))));
    return Array.from({length: count}, (_, index) => {
      const t = index / Math.max(1, count - 1);
      const angle = start + delta * t;
      return new THREE.Vector3(center.x + Math.cos(angle) * 0.62, center.y, center.z + Math.sin(angle) * 0.62);
    });
  }, [center, hipA, hipB, progress, shoulderA, shoulderB]);
  return <LineMesh points={points} color="#ffffff" opacity={0.86} />;
};

const StudioFloor: React.FC<{focus: THREE.Vector3}> = ({focus}) => (
  <group>
    <mesh position={[focus.x, -0.06, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[5.7, 96]} />
      <meshStandardMaterial color="#120904" roughness={0.5} metalness={0.08} transparent opacity={0.92} />
    </mesh>
    <mesh position={[focus.x, -0.055, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.2, 5.5, 96]} />
      <meshBasicMaterial color={DEEP_BLUE} transparent opacity={0.16} />
    </mesh>
  </group>
);

const ContactShadow: React.FC<{player: Player}> = ({player}) => {
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  if (!pelvis) return null;
  return (
    <mesh position={[pelvis.x, -0.045, pelvis.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.35, 48]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.32} />
    </mesh>
  );
};

const ContactSpark: React.FC<{position: THREE.Vector3; progress: number}> = ({position, progress}) => (
  <group>
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.38 + progress * 0.12, 0.025, 14, 52]} />
      <meshBasicMaterial color={ACCENT_BLUE} transparent opacity={0.82} />
    </mesh>
    <pointLight position={position} color={ACCENT_BLUE} intensity={1.2 + progress * 1.6} distance={3.2} />
  </group>
);

const FootGlow: React.FC<{point: THREE.Vector3}> = ({point}) => (
  <mesh position={point}>
    <sphereGeometry args={[0.18, 18, 18]} />
    <meshBasicMaterial color={ACCENT_BLUE} transparent opacity={0.22} />
  </mesh>
);

const CinematicBall: React.FC<{position: THREE.Vector3}> = ({position}) => (
  <mesh position={position}>
    <sphereGeometry args={[0.18, 28, 28]} />
    <meshStandardMaterial color={BALL} roughness={0.28} emissive="#051a40" emissiveIntensity={0.2} />
  </mesh>
);

const PitchScene = () => (
  <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.045, 0]}>
      <planeGeometry args={[105, 68]} />
      <meshStandardMaterial color="#0d4a1c" roughness={0.92} />
    </mesh>
    <LineMesh points={rectPoints(-52.5, -20.16, 16.5, 40.32)} color="#ffffff" opacity={0.42} />
    <LineMesh points={rectPoints(-52.5, -9.16, 5.5, 18.32)} color="#ffffff" opacity={0.36} />
    <LineMesh points={[new THREE.Vector3(-52.5, 0.02, -34), new THREE.Vector3(-52.5, 0.02, 34)]} color="#ffffff" opacity={0.4} />
  </group>
);

const GoalFrame = () => {
  const x = -52.5;
  const width = 7.32;
  const height = 2.44;
  const z0 = -width / 2;
  const z1 = width / 2;
  const y0 = 0;
  const y1 = height;
  const back = -1.8;
  return (
    <group>
      <CylinderBetween start={new THREE.Vector3(x, y0, z0)} end={new THREE.Vector3(x, y1, z0)} radius={0.035} color="#ffffff" opacity={0.95} />
      <CylinderBetween start={new THREE.Vector3(x, y0, z1)} end={new THREE.Vector3(x, y1, z1)} radius={0.035} color="#ffffff" opacity={0.95} />
      <CylinderBetween start={new THREE.Vector3(x, y1, z0)} end={new THREE.Vector3(x, y1, z1)} radius={0.035} color="#ffffff" opacity={0.95} />
      <CylinderBetween start={new THREE.Vector3(x, y1, z0)} end={new THREE.Vector3(x + back, y1, z0)} radius={0.02} color="#ffffff" opacity={0.38} />
      <CylinderBetween start={new THREE.Vector3(x, y1, z1)} end={new THREE.Vector3(x + back, y1, z1)} radius={0.02} color="#ffffff" opacity={0.38} />
      {Array.from({length: 9}, (_, index) => {
        const z = z0 + (width / 8) * index;
        return <LineMesh key={`net-z-${index}`} points={[new THREE.Vector3(x, 0, z), new THREE.Vector3(x + back, height, z)]} color="#ffffff" opacity={0.18} />;
      })}
    </group>
  );
};

const KeeperGhost = () => {
  const base = new THREE.Vector3(-51.7, 0.28, 0);
  return (
    <group>
      <pointLight position={[-51.5, 1.5, 0]} color={CYAN} intensity={2.1} distance={5} />
      <CylinderBetween start={base} end={base.clone().add(new THREE.Vector3(0, 1.1, 0))} radius={0.1} color={CYAN} opacity={0.5} />
      <CylinderBetween start={base.clone().add(new THREE.Vector3(0, 0.78, 0))} end={base.clone().add(new THREE.Vector3(0, 0.48, -0.55))} radius={0.055} color={CYAN} opacity={0.48} />
      <CylinderBetween start={base.clone().add(new THREE.Vector3(0, 0.78, 0))} end={base.clone().add(new THREE.Vector3(0, 0.48, 0.55))} radius={0.055} color={CYAN} opacity={0.48} />
      <mesh position={base.clone().add(new THREE.Vector3(0, 1.28, 0))}>
        <sphereGeometry args={[0.16, 18, 18]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.48} />
      </mesh>
    </group>
  );
};

const DistantPlayer: React.FC<{player: Player}> = ({player}) => {
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  const neck = player.parts.neck ? toThree(player.parts.neck) : null;
  if (!pelvis || !neck) return null;
  const color = player.teamCode === 1 ? ACCENT_BLUE : "#162a3d";
  return <CylinderBetween start={pelvis} end={neck} radius={0.04} color={color} opacity={0.3} />;
};

const ReleasePath: React.FC<{clip: Clip; progress: number}> = ({clip, progress}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact)
    .map((frame) => frame.ball?.position)
    .filter((point): point is Vec3 => Boolean(point))
    .map(toThree);
  const count = Math.max(2, Math.round(points.length * Math.max(0, Math.min(1, progress))));
  const shown = points.slice(0, count);
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color="#ffffff" opacity={0.72} />
      {shown.filter((_, index) => index % 5 === 0).map((point, index) => (
        <mesh key={`shot-dot-${index}`} position={point}>
          <sphereGeometry args={[0.07, 14, 14]} />
          <meshBasicMaterial color={ACCENT_BLUE} transparent opacity={0.78} />
        </mesh>
      ))}
    </group>
  );
};

const HudlOverlay: React.FC<{clip: Clip; frame: number; mode: "macro" | "goal"}> = ({clip, frame, mode}) => {
  const showLabels = frame >= MACRO_START && frame < GOAL_START;
  const showMetrics = frame >= METRIC_START && frame < GOAL_START;
  const xg = numberValue(clip.features.shot_value);
  return (
    <>
      <div style={styles.titleBlock}>
        <div style={styles.kicker}>Shooting biomech visualizer</div>
        <div style={styles.title}>{mode === "goal" ? "Shot output" : "Contact mechanics"}</div>
      </div>
      {mode === "macro" ? (
        <>
          <MacroLeaderSvg visible={showLabels} metrics={showMetrics} />
          <HudlLabel side="left" x={150} y={760} visible={showLabels} text="Technique: right-foot strike" />
          <HudlLabel side="right" x={1325} y={320} visible={showLabels} text="Body part: right foot" />
          <HudlLabel side="right" x={1330} y={620} visible={showLabels} text={`Ball height: ${formatHeight(numberValue(clip.features.ball_z_at_contact))}`} />
          <HudlLabel side="left" x={130} y={520} visible={showMetrics} text={`Plant base: ${formatDistance(numberValue(clip.features.plant_foot_lateral_offset_m))}`} />
          <HudlLabel side="right" x={1320} y={500} visible={showMetrics} text={`Contact gap: ${formatDistance(numberValue(clip.features.min_foot_ball_distance_m))}`} />
          <div style={{...styles.blueBadge, opacity: showMetrics ? 1 : 0}}>
            {formatDistance(numberValue(clip.features.plant_foot_lateral_offset_m))} brace width
          </div>
        </>
      ) : (
        <>
          <div style={styles.xgText}>xG={Number.isNaN(xg) ? "0.00" : xg.toFixed(2)}</div>
          <div style={styles.goalHint}>Release path carries the contact into shot outcome</div>
        </>
      )}
    </>
  );
};

const HudlAtmosphere: React.FC<{mode: "macro" | "goal"}> = ({mode}) => (
  <>
    <div style={mode === "macro" ? styles.blueWash : styles.fieldWash} />
    <div style={styles.vignette} />
  </>
);

const MacroLeaderSvg: React.FC<{visible: boolean; metrics: boolean}> = ({visible, metrics}) => (
  <svg style={{...styles.leaderSvg, opacity: visible ? 1 : 0}} viewBox="0 0 1920 1080">
    <polyline points="620,800 760,800 875,910" fill="none" stroke={LINE} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="1280,345 1185,345 885,930" fill="none" stroke={LINE} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="1285,645 1170,645 1115,925" fill="none" stroke={LINE} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    {metrics ? (
      <>
        <polyline points="520,548 690,548 840,905" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="1280,526 1160,526 1010,916" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : null}
  </svg>
);

const HudlLabel: React.FC<{text: string; x: number; y: number; side: "left" | "right"; visible: boolean}> = ({text, x, y, side, visible}) => (
  <div
    style={{
      ...styles.hudlLabel,
      left: x,
      top: y,
      opacity: visible ? 1 : 0,
      textAlign: side === "right" ? "left" : "right",
    }}
  >
    {text}
  </div>
);

const CameraRig: React.FC<{position: THREE.Vector3; target: THREE.Vector3; fov: number}> = ({position, target, fov}) => {
  const {camera} = useThree();
  useLayoutEffect(() => {
    camera.position.copy(position);
    camera.lookAt(target);
    if ("fov" in camera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
    }
    camera.updateProjectionMatrix();
  }, [camera, fov, position, target]);
  return null;
};

const CylinderBetween: React.FC<{start: THREE.Vector3; end: THREE.Vector3; radius: number; color: string; opacity: number}> = ({
  start,
  end,
  radius,
  color,
  opacity,
}) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.001) return null;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 14]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.34} metalness={0.04} />
    </mesh>
  );
};

const AnimatedCylinder: React.FC<{start: THREE.Vector3; end: THREE.Vector3; color: string; progress: number; radius: number}> = ({
  start,
  end,
  color,
  progress,
  radius,
}) => {
  const current = start.clone().lerp(end, Math.max(0, Math.min(1, progress)));
  return <CylinderBetween start={start} end={current} radius={radius} color={color} opacity={0.94} />;
};

const LineMesh: React.FC<{points: THREE.Vector3[]; color: string; opacity: number}> = ({points, color, opacity}) => {
  const line = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({color, transparent: true, opacity}),
  ), [color, opacity, points]);
  return <primitive object={line} />;
};

const cameraForHudl = (clip: Clip, mode: "macro" | "goal", shotFrame: ShotFrame, contactFrame: ShotFrame, frame: number) => {
  const contactTarget = macroTarget(clip, contactFrame);
  if (mode === "goal") {
    const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : contactTarget;
    const progress = eased(frame, GOAL_START, DURATION - 100);
    const target = contactTarget.clone().lerp(ball, progress * 0.42).add(new THREE.Vector3(0.4, 0.45, 0));
    return {
      position: target.clone().add(new THREE.Vector3(8.4, 2.7, 6.2)),
      target,
      fov: 34,
    };
  }
  const approach = eased(frame, 0, MACRO_START + 80);
  const metric = eased(frame, METRIC_START, GOAL_START - 60);
  const target = contactTarget.clone().add(new THREE.Vector3(0, 0.88, 0));
  const radius = lerp(6.5, 5.1, approach) + metric * 0.25;
  const angle = lerp(-1.02, -0.66, approach);
  return {
    position: new THREE.Vector3(target.x + Math.cos(angle) * radius, target.y + lerp(2.7, 2.0, approach), target.z + Math.sin(angle) * radius),
    target,
    fov: lerp(36, 33, approach),
  };
};

const frameForHudl = (clip: Clip, frame: number): ShotFrame => {
  const contact = contactNumber(clip);
  if (frame < MACRO_START + 80) {
    const frameNumber = interpolate(frame, [0, MACRO_START + 80], [clip.frameWindow.start, contact], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.18, 0.9, 0.2, 1),
    });
    return interpolatedFrame(clip, frameNumber);
  }
  if (frame < GOAL_START) return nearestFrame(clip, contact);
  const frameNumber = interpolate(frame, [GOAL_START, DURATION], [contact, clip.frameWindow.end], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.0, 0.1, 1),
  });
  return interpolatedFrame(clip, frameNumber);
};

const macroTarget = (clip: Clip, frame: ShotFrame) => {
  const player = (frame.players || []).find((item) => item.name === clip.shot.player);
  const ball = frame.ball?.position ? toThree(frame.ball.position) : null;
  const pelvis = player?.parts.pelvis ? toThree(player.parts.pelvis) : null;
  const strike = player ? strikeFootPoint(clip, player) : null;
  if (ball && pelvis) return pelvis.clone().lerp(ball, 0.44);
  if (ball && strike) return ball.clone().lerp(strike, 0.44);
  if (ball && pelvis) return ball.clone().lerp(pelvis, 0.5);
  return ball || pelvis || new THREE.Vector3(0, 1, 0);
};

const nearestFrame = (clip: Clip, frameNumber: number) => clip.frames.reduce((best, frame) => (
  Math.abs(frame.frameNumber - frameNumber) < Math.abs(best.frameNumber - frameNumber) ? frame : best
), clip.frames[0]);

const interpolatedFrame = (clip: Clip, frameNumber: number): ShotFrame => {
  const previous = clip.frames.reduce((best, frame) => frame.frameNumber <= frameNumber && frame.frameNumber > best.frameNumber ? frame : best, clip.frames[0]);
  const next = clip.frames.find((frame) => frame.frameNumber >= frameNumber) || previous;
  if (previous.frameNumber === next.frameNumber) return previous;
  const amount = (frameNumber - previous.frameNumber) / (next.frameNumber - previous.frameNumber);
  return {
    frameNumber: Math.round(frameNumber),
    ball: interpolateBall(previous.ball, next.ball, amount),
    players: interpolatePlayers(previous.players || [], next.players || [], amount),
  };
};

const interpolateBall = (a?: Ball | null, b?: Ball | null, amount = 0): Ball | null => {
  if (!a?.position || !b?.position) return a || b || null;
  return {position: lerpVec(a.position, b.position, amount), velocity: a.velocity || b.velocity};
};

const interpolatePlayers = (aPlayers: Player[], bPlayers: Player[], amount: number): Player[] => aPlayers.map((player) => {
  const match = bPlayers.find((other) => other.name === player.name && other.jerseyNumber === player.jerseyNumber) || player;
  const parts = Object.fromEntries(Object.entries(player.parts).map(([name, point]) => [
    name,
    match.parts[name] ? lerpVec(point, match.parts[name], amount) : point,
  ]));
  return {...player, parts};
});

const contactNumber = (clip: Clip) => clip.frameRoles.contactFrame || clip.frameWindow.contact || clip.frameWindow.start;
const toThree = (point: Vec3) => new THREE.Vector3(point.x, point.z, -point.y);
const strikeFootPoint = (clip: Clip, player: Player) => {
  const foot = String(clip.features.inferred_foot || "right");
  const point = player.parts[`${foot}_toe`] || player.parts[`${foot}_ankle`] || player.parts[`${foot}_heel`];
  return point ? toThree(point) : null;
};
const plantFootPoint = (clip: Clip, player: Player) => {
  const foot = String(clip.features.plant_foot || "left");
  const point = player.parts[`${foot}_toe`] || player.parts[`${foot}_ankle`] || player.parts[`${foot}_heel`];
  return point ? toThree(point) : null;
};
const rectPoints = (x: number, z: number, width: number, height: number) => [
  new THREE.Vector3(x, 0.02, z),
  new THREE.Vector3(x + width, 0.02, z),
  new THREE.Vector3(x + width, 0.02, z + height),
  new THREE.Vector3(x, 0.02, z + height),
  new THREE.Vector3(x, 0.02, z),
];
const eased = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.16, 1, 0.3, 1),
});
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const lerpVec = (a: Vec3, b: Vec3, amount: number): Vec3 => ({x: lerp(a.x, b.x, amount), y: lerp(a.y, b.y, amount), z: lerp(a.z, b.z, amount)});
const numberValue = (value: string | number | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : Number.NaN;
};
const formatDistance = (value: number) => Number.isNaN(value) ? "-" : `${Math.abs(value).toFixed(2)}m`;
const formatHeight = (value: number) => Number.isNaN(value) ? "-" : `${(Math.max(0, value) * 3.28084).toFixed(1)} ft`;

const styles: Record<string, React.CSSProperties> = {
  root: {background: BLACK, color: WHITE, fontFamily: "Inter, Arial, Helvetica, sans-serif"},
  blueWash: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(180deg, rgba(4,28,74,0.84) 0%, rgba(16,64,134,0.34) 30%, rgba(0,0,0,0.03) 56%, rgba(0,0,0,0.72) 100%)",
    pointerEvents: "none",
  },
  fieldWash: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.28)), radial-gradient(ellipse at 70% 18%, rgba(255,255,255,0.12), rgba(255,255,255,0) 30%)",
    pointerEvents: "none",
  },
  vignette: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(ellipse at 50% 48%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.2) 58%, rgba(0,0,0,0.78) 100%)",
    pointerEvents: "none",
  },
  titleBlock: {position: "absolute", left: 58, top: 48, color: WHITE},
  kicker: {fontSize: 19, fontWeight: 800, textTransform: "uppercase", color: "rgba(255,255,255,0.64)", letterSpacing: 0},
  title: {fontSize: 54, lineHeight: 1.02, marginTop: 7, fontWeight: 900, letterSpacing: 0},
  leaderSvg: {position: "absolute", inset: 0, width: "100%", height: "100%", transition: "none", pointerEvents: "none"},
  hudlLabel: {
    position: "absolute",
    width: 470,
    color: "rgba(255,255,255,0.86)",
    fontSize: 34,
    fontWeight: 780,
    lineHeight: 1.05,
    textShadow: "0 3px 14px rgba(0,0,0,0.8)",
    transition: "none",
  },
  blueBadge: {
    position: "absolute",
    left: 735,
    top: 180,
    padding: "14px 22px",
    background: "rgba(47,125,255,0.92)",
    color: "#eef7ff",
    borderRadius: 4,
    fontSize: 31,
    fontWeight: 900,
    boxShadow: "0 10px 34px rgba(0,0,0,0.42), 0 0 28px rgba(101,233,255,0.22)",
  },
  xgText: {
    position: "absolute",
    left: 72,
    top: 255,
    fontSize: 94,
    lineHeight: 1,
    fontWeight: 950,
    color: "#ffffff",
    textShadow: "0 7px 24px rgba(0,0,0,0.65)",
  },
  goalHint: {
    position: "absolute",
    left: 82,
    top: 362,
    width: 560,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 780,
    color: "rgba(255,255,255,0.78)",
    textShadow: "0 4px 16px rgba(0,0,0,0.75)",
  },
};
