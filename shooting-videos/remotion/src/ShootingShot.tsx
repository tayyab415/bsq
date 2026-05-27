import {ThreeCanvas} from "@remotion/three";
import {useThree} from "@react-three/fiber";
import React, {useLayoutEffect, useMemo} from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import * as THREE from "three";
import shotWindow from "../public/shot-window.json";

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type Ball = {
  position?: Vec3;
  velocity?: Vec3;
};

type Player = {
  name?: string;
  jerseyNumber?: number | string;
  teamCode?: number;
  nearestBallDistance?: number;
  parts: Record<string, Vec3>;
};

type ShotFrame = {
  frameNumber: number;
  ball?: Ball | null;
  players?: Player[];
};

type ShotData = {
  matchFolder: string;
  eventId: string;
  shot: {
    player?: string;
    team?: string;
  };
  score?: {
    family?: string;
    technique_mechanics_score?: number | string;
    strike_quality_score?: number | string;
    shot_result?: string;
  };
  frameRoles: {
    contactFrame?: number;
    physicsExitFrame?: number;
    visualContactFrame?: number;
  };
  frameWindow: {
    start: number;
    end: number;
    contact?: number;
    physicsExit?: number;
    impact?: number;
  };
  frames: ShotFrame[];
};

const data = shotWindow as unknown as ShotData;

const BODY_CONNECTIONS = [
  ["left_ear", "nose"],
  ["right_ear", "nose"],
  ["nose", "neck"],
  ["neck", "left_shoulder"],
  ["neck", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["neck", "pelvis"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "pelvis"],
  ["right_hip", "pelvis"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_heel"],
  ["left_ankle", "left_toe"],
  ["left_heel", "left_toe"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_ankle", "right_toe"],
  ["right_heel", "right_toe"],
] as const;

const LEFT_COLOR = "#4ea4ff";
const RIGHT_COLOR = "#ff9b42";
const CENTER_COLOR = "#75d6a1";
const BALL_COLOR = "#f2bf5e";
const HOME_COLOR = "#e85d5d";
const AWAY_COLOR = "#80c8ff";

export const ShootingShot = () => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const shotFrame = useMemo(() => frameForVideoFrame(frame), [frame]);
  const contactFrame = useMemo(() => nearestFrame(contactNumber()), []);
  const camera = useMemo(() => cameraForVideoFrame(frame, shotFrame, contactFrame), [
    contactFrame,
    frame,
    shotFrame,
  ]);
  const stage = stageLabel(frame, fps);

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#070908"]} />
        <ambientLight intensity={0.75} />
        <hemisphereLight args={["#ffffff", "#1a241d", 1.25]} />
        <directionalLight position={[16, 34, -18]} intensity={2.4} />
        <directionalLight position={[-18, 18, 18]} intensity={0.85} />
        <CameraRig position={camera.position} target={camera.target} />
        <ShotWorld shotFrame={shotFrame} contactFrame={contactFrame} videoFrame={frame} />
      </ThreeCanvas>
      <div style={styles.vignette} />
      <div style={styles.topBar}>
        <div>
          <div style={styles.eyebrow}>{data.matchFolder.replace("_", " ")} / {data.eventId}</div>
          <div style={styles.title}>{data.shot.player || "Shot"} contact study</div>
        </div>
        <div style={styles.badge}>{stage}</div>
      </div>
      <div style={styles.metricRail}>
        <Metric label="Family" value={data.score?.family || "shot"} />
        <Metric label="Mechanics" value={scoreValue(data.score?.technique_mechanics_score)} />
        <Metric label="Strike" value={scoreValue(data.score?.strike_quality_score)} />
        <Metric label="Frame" value={String(shotFrame.frameNumber)} />
      </div>
      <div style={styles.timeline}>
        <div style={{...styles.timelineFill, width: `${(frame / 269) * 100}%`}} />
      </div>
    </AbsoluteFill>
  );
};

const ShotWorld: React.FC<{
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  videoFrame: number;
}> = ({shotFrame, contactFrame, videoFrame}) => {
  const shooterName = data.shot.player;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : null;
  const shotBall = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const shooter = (shotFrame.players || []).find((player) => player.name === shooterName);
  const contactShooter = (contactFrame.players || []).find((player) => player.name === shooterName);
  const frozen = videoFrame >= 45 && videoFrame < 195;

  return (
    <group>
      <Pitch />
      <BallTrail currentFrame={shotFrame.frameNumber} />
      {(shotFrame.players || []).map((player) => (
        <PlayerSkeleton
          key={`${shotFrame.frameNumber}-${player.teamCode}-${player.jerseyNumber}-${player.name}`}
          player={player}
          isShooter={player.name === shooterName}
          frozen={frozen}
        />
      ))}
      {contactBall ? (
        <>
          <mesh position={contactBall} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.46, 0.026, 12, 42]} />
            <meshBasicMaterial color="#ffd166" transparent opacity={0.9} />
          </mesh>
          <mesh position={[contactBall.x, contactBall.y + 0.02, contactBall.z]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.74, 0.012, 12, 64]} />
            <meshBasicMaterial color="#7bb8ff" transparent opacity={0.48} />
          </mesh>
        </>
      ) : null}
      {shotBall ? (
        <mesh position={shotBall}>
          <sphereGeometry args={[0.19, 28, 28]} />
          <meshStandardMaterial color={BALL_COLOR} roughness={0.34} emissive="#352207" />
        </mesh>
      ) : null}
      {shooter && shotBall ? <ContactProbe player={shooter} ball={shotBall} /> : null}
      {contactShooter && contactBall ? <ContactProbe player={contactShooter} ball={contactBall} force /> : null}
      {shotBall && shotFrame.ball?.velocity ? <VelocityVector ball={shotBall} velocity={shotFrame.ball.velocity} /> : null}
    </group>
  );
};

const Pitch = () => {
  const lineMaterial = "#e9efe5";
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial color="#255b3c" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.038, 0]}>
        <planeGeometry args={[105, 68]} />
        <meshBasicMaterial color="#163625" transparent opacity={0.32} />
      </mesh>
      <Line points={rectPoints(-52.5, -34, 105, 68)} color={lineMaterial} opacity={0.72} />
      <Line points={[new THREE.Vector3(0, 0.03, -34), new THREE.Vector3(0, 0.03, 34)]} color={lineMaterial} opacity={0.65} />
      <Line points={circlePoints(0, 0, 9.15)} color={lineMaterial} opacity={0.62} />
      <Line points={rectPoints(-52.5, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.72} />
      <Line points={rectPoints(36, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.72} />
      <Line points={rectPoints(-52.5, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.72} />
      <Line points={rectPoints(47, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.72} />
    </group>
  );
};

const PlayerSkeleton: React.FC<{
  player: Player;
  isShooter: boolean;
  frozen: boolean;
}> = ({player, isShooter, frozen}) => {
  const baseColor = player.teamCode === 1 ? HOME_COLOR : AWAY_COLOR;
  if (!isShooter) {
    const opacity = frozen ? 0.14 : 0.22;
    return (
      <group>
        {BODY_CONNECTIONS.map(([from, to]) => {
          const a = player.parts[from];
          const b = player.parts[to];
          if (!a || !b) return null;
          return (
            <CylinderBetween
              key={`${from}-${to}`}
              start={toThree(a)}
              end={toThree(b)}
              radius={0.024}
              color={baseColor}
              opacity={opacity}
            />
          );
        })}
      </group>
    );
  }
  const opacity = 1;
  const radius = 0.055;
  const jointRadius = 0.105;

  return (
    <group>
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        return (
          <CylinderBetween
            key={`${from}-${to}`}
            start={toThree(a)}
            end={toThree(b)}
            radius={radius}
            color={segmentColor(from, to)}
            opacity={opacity}
          />
        );
      })}
      {Object.entries(player.parts).map(([name, point]) => (
        <mesh key={name} position={toThree(point)}>
          <sphereGeometry args={[jointRadius, 12, 12]} />
          <meshStandardMaterial
            color={jointColor(name)}
            transparent
            opacity={opacity}
            roughness={0.48}
            emissive="#092014"
          />
        </mesh>
      ))}
    </group>
  );
};

const ContactProbe: React.FC<{
  player: Player;
  ball: THREE.Vector3;
  force?: boolean;
}> = ({player, ball, force = false}) => {
  const leftToe = player.parts.left_toe ? toThree(player.parts.left_toe) : null;
  const rightToe = player.parts.right_toe ? toThree(player.parts.right_toe) : null;
  const leftDistance = leftToe ? leftToe.distanceTo(ball) : Number.POSITIVE_INFINITY;
  const rightDistance = rightToe ? rightToe.distanceTo(ball) : Number.POSITIVE_INFINITY;
  const foot = leftDistance <= rightDistance ? leftToe : rightToe;

  if (!foot) return null;

  return (
    <group>
      <Line points={[foot, ball]} color={force ? "#ffd166" : "#ffffff"} opacity={force ? 0.94 : 0.42} />
      <mesh position={foot}>
        <sphereGeometry args={[force ? 0.18 : 0.12, 16, 16]} />
        <meshBasicMaterial color={force ? "#ffd166" : "#ffffff"} transparent opacity={force ? 0.86 : 0.45} />
      </mesh>
    </group>
  );
};

const VelocityVector: React.FC<{ball: THREE.Vector3; velocity: Vec3}> = ({ball, velocity}) => {
  const end = ball.clone().add(new THREE.Vector3(velocity.x, velocity.z, -velocity.y).multiplyScalar(0.16));
  return (
    <group>
      <Line points={[ball, end]} color="#ff6f91" opacity={0.9} />
      <mesh position={end}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color="#ff6f91" />
      </mesh>
    </group>
  );
};

const BallTrail: React.FC<{currentFrame: number}> = ({currentFrame}) => {
  const contact = contactNumber();
  const points = data.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= currentFrame)
    .map((frame) => frame.ball?.position)
    .filter((position): position is Vec3 => Boolean(position))
    .map(toThree);

  if (points.length < 2) return null;

  return <Line points={points} color="#f7c65f" opacity={0.62} />;
};

const CylinderBetween: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  opacity: number;
}> = ({start, end, radius, color, opacity}) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );

  if (length < 0.001) return null;

  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.5} />
    </mesh>
  );
};

const Line: React.FC<{
  points: THREE.Vector3[];
  color: string;
  opacity: number;
}> = ({points, color, opacity}) => {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    });
    return new THREE.Line(geometry, material);
  }, [color, opacity, points]);

  return <primitive object={line} />;
};

const CameraRig: React.FC<{position: THREE.Vector3; target: THREE.Vector3}> = ({position, target}) => {
  const {camera} = useThree();

  useLayoutEffect(() => {
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }, [camera, position, target]);

  return null;
};

const frameForVideoFrame = (videoFrame: number): ShotFrame => {
  const contact = contactNumber();
  if (videoFrame < 45) {
    const frameNumber = interpolate(videoFrame, [0, 45], [data.frameWindow.start, contact], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    return nearestFrame(Math.round(frameNumber));
  }

  if (videoFrame < 195) {
    return nearestFrame(contact);
  }

  const frameNumber = interpolate(videoFrame, [195, 269], [contact, data.frameWindow.end], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return nearestFrame(Math.round(frameNumber));
};

const cameraForVideoFrame = (
  videoFrame: number,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
) => {
  const contactTarget = focusTarget(contactFrame);
  const liveTarget = focusTarget(shotFrame);
  let target = contactTarget.clone();
  let radius = 30;
  let height = 12;
  let angle = -0.92;

  if (videoFrame < 45) {
    const progress = eased(videoFrame, 0, 45);
    radius = lerp(40, 22, progress);
    height = lerp(18, 8, progress);
    angle = lerp(-1.15, -0.74, progress);
    target = focusTarget(shotFrame).lerp(contactTarget, progress * 0.65);
  } else if (videoFrame < 75) {
    const progress = eased(videoFrame, 45, 75);
    radius = lerp(22, 5.0, progress);
    height = lerp(8, 2.2, progress);
    angle = -0.74;
  } else if (videoFrame < 165) {
    const progress = (videoFrame - 75) / 90;
    radius = 5.0;
    height = 2.35;
    angle = -0.74 + Math.PI * 2 * progress;
  } else if (videoFrame < 195) {
    const progress = eased(videoFrame, 165, 195);
    radius = lerp(5.0, 31, progress);
    height = lerp(2.35, 13, progress);
    angle = lerp(-0.74 + Math.PI * 2, -0.95, progress);
  } else {
    const progress = eased(videoFrame, 195, 269);
    target = contactTarget.clone().lerp(liveTarget, progress);
    radius = lerp(31, 36, progress);
    height = lerp(13, 15.5, progress);
    angle = -0.95;
  }

  const position = new THREE.Vector3(
    target.x + Math.cos(angle) * radius,
    target.y + height,
    target.z + Math.sin(angle) * radius,
  );

  return {position, target};
};

const focusTarget = (frame: ShotFrame): THREE.Vector3 => {
  if (frame.ball?.position) {
    return toThree(frame.ball.position);
  }

  const shooter = (frame.players || []).find((player) => player.name === data.shot.player);
  const pelvis = shooter?.parts.pelvis || shooter?.parts.neck;
  return pelvis ? toThree(pelvis) : new THREE.Vector3(0, 1, 0);
};

const nearestFrame = (frameNumber: number): ShotFrame => {
  return data.frames.reduce((best, frame) => {
    return Math.abs(frame.frameNumber - frameNumber) < Math.abs(best.frameNumber - frameNumber) ? frame : best;
  }, data.frames[0]);
};

const contactNumber = () => {
  return data.frameRoles.contactFrame || data.frameWindow.contact || data.frameWindow.start;
};

const toThree = (point: Vec3) => new THREE.Vector3(point.x, point.z, -point.y);

const segmentColor = (from: string, to: string) => {
  if (from.startsWith("left_") && to.startsWith("left_")) return LEFT_COLOR;
  if (from.startsWith("right_") && to.startsWith("right_")) return RIGHT_COLOR;
  return CENTER_COLOR;
};

const jointColor = (part: string) => {
  if (part.startsWith("left_")) return LEFT_COLOR;
  if (part.startsWith("right_")) return RIGHT_COLOR;
  return CENTER_COLOR;
};

const rectPoints = (x: number, z: number, width: number, height: number) => [
  new THREE.Vector3(x, 0.035, z),
  new THREE.Vector3(x + width, 0.035, z),
  new THREE.Vector3(x + width, 0.035, z + height),
  new THREE.Vector3(x, 0.035, z + height),
  new THREE.Vector3(x, 0.035, z),
];

const circlePoints = (x: number, z: number, radius: number) => {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, 0.04, z + Math.sin(angle) * radius));
  }
  return points;
};

const eased = (frame: number, start: number, end: number) => {
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
};

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

const stageLabel = (frame: number, fps: number) => {
  const seconds = (frame / fps).toFixed(1);
  if (frame < 45) return `build-up / ${seconds}s`;
  if (frame < 75) return `contact zoom / ${seconds}s`;
  if (frame < 165) return `360 contact orbit / ${seconds}s`;
  if (frame < 195) return `zoom out / ${seconds}s`;
  return `shot release / ${seconds}s`;
};

const scoreValue = (value?: number | string) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || Number.isNaN(parsed)) return "-";
  return String(Math.round(parsed));
};

const Metric: React.FC<{label: string; value: string}> = ({label, value}) => {
  return (
    <div style={styles.metric}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: "#070908",
    color: "#f3f7f2",
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },
  vignette: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at 50% 46%, rgba(255,255,255,0) 0%, rgba(7,9,8,0.16) 50%, rgba(7,9,8,0.74) 100%)",
    pointerEvents: "none",
  },
  topBar: {
    position: "absolute",
    top: 46,
    left: 58,
    right: 58,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#a9b7ad",
    fontSize: 24,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  title: {
    marginTop: 8,
    fontSize: 52,
    fontWeight: 800,
    lineHeight: 1.02,
  },
  badge: {
    minWidth: 300,
    textAlign: "right",
    padding: "14px 20px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(7,9,8,0.56)",
    borderRadius: 8,
    fontSize: 24,
    fontWeight: 800,
  },
  metricRail: {
    position: "absolute",
    left: 58,
    bottom: 58,
    display: "flex",
    gap: 12,
  },
  metric: {
    minWidth: 132,
    padding: "16px 18px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(7,9,8,0.62)",
    borderRadius: 8,
    whiteSpace: "nowrap",
  },
  metricValue: {
    fontSize: 34,
    fontWeight: 850,
    lineHeight: 1,
  },
  metricLabel: {
    marginTop: 8,
    color: "#aab5ad",
    fontSize: 18,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  timeline: {
    position: "absolute",
    left: 58,
    right: 58,
    bottom: 28,
    height: 5,
    background: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    overflow: "hidden",
  },
  timelineFill: {
    height: "100%",
    background: "#ffd166",
  },
};
