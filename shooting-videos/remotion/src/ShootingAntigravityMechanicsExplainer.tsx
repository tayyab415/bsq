import {ThreeCanvas} from "@remotion/three";
import {useThree, useFrame as useThreeFrame} from "@react-three/fiber";
import React, {useMemo, useRef} from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from "remotion";
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
  eventId: string;
  shot: {player?: string; team?: string};
  score: Record<string, string | number | null>;
  features: Record<string, string | number | null>;
  frameRoles: {
    contactFrame?: number;
    physicsExitFrame?: number;
    visualContactFrame?: number;
    biomechFrame?: number;
  };
  frameWindow: {
    start: number;
    end: number;
    contact?: number;
  };
  frames: ShotFrame[];
};
type ExplainerData = {clips: Clip[]};

const data = explainerPair as unknown as ExplainerData;

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

const COLORS = {
  background: "#0a111a",
  shooter: "#eef7ff",
  strikeFoot: "#12f0e0",
  plantFoot: "#9df012",
  contact: "#ff1eb0",
  shoulder: "#2c89f5",
  hip: "#935eff",
  path: "#9edbff",
  opponents: "rgba(100, 120, 140, 0.25)",
  grid: "#152433",
  panel: "rgba(6, 11, 18, 0.8)",
  textMain: "#ffffff",
  textMuted: "#8ba0b5",
};

const PHASE_FRAMES = 300;
type PhaseId = "approach" | "coil" | "contact" | "carry" | "output";
const PHASES: Array<{id: PhaseId; title: string}> = [
  {id: "approach", title: "APPROACH"},
  {id: "coil", title: "COIL (BACKSWING)"},
  {id: "contact", title: "CONTACT GAP"},
  {id: "carry", title: "FOLLOW-THROUGH"},
  {id: "output", title: "STRIKE OUTPUT"},
];

function phaseForFrame(frame: number) {
  const index = Math.min(Math.floor(frame / PHASE_FRAMES), PHASES.length - 1);
  return {
    ...PHASES[index],
    localFrame: frame % PHASE_FRAMES,
    index,
  };
}

export const AntigravityMechanicsExplainer = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const clip = data.clips[0];
  const phase = phaseForFrame(frame);

  // Derive target frame from phase
  let targetDataFrame = clip.frameRoles.contactFrame || 0;
  const contactFrame = clip.frameRoles.contactFrame || 0;
  
  if (phase.id === "approach") {
    targetDataFrame = contactFrame - 20 + Math.floor((phase.localFrame / PHASE_FRAMES) * 15);
  } else if (phase.id === "coil") {
    targetDataFrame = contactFrame - 15 + Math.floor((phase.localFrame / PHASE_FRAMES) * 10);
  } else if (phase.id === "contact") {
    targetDataFrame = contactFrame;
  } else if (phase.id === "carry") {
    targetDataFrame = contactFrame + Math.floor((phase.localFrame / PHASE_FRAMES) * 15);
  } else if (phase.id === "output") {
    targetDataFrame = contactFrame + 5 + Math.floor((phase.localFrame / PHASE_FRAMES) * 20);
  }
  
  targetDataFrame = Math.max(clip.frameWindow.start, Math.min(targetDataFrame, clip.frameWindow.end));
  const shotFrame = clip.frames.find((f) => f.frameNumber === targetDataFrame) || clip.frames[0];

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.background}}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={[COLORS.background]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[20, 40, -20]} intensity={1.5} color="#ffffff" />
        <Scene clip={clip} shotFrame={shotFrame} phase={phase} />
      </ThreeCanvas>
      <Overlay clip={clip} phase={phase} />
    </AbsoluteFill>
  );
};

const Scene: React.FC<{clip: Clip; shotFrame: ShotFrame; phase: ReturnType<typeof phaseForFrame>}> = ({clip, shotFrame, phase}) => {
  const contactFrameIdx = clip.frameRoles.contactFrame || 0;
  const contactFrame = clip.frames.find((f) => f.frameNumber === contactFrameIdx) || clip.frames[0];
  
  const shooterName = clip.shot.player;
  const shooter = (shotFrame.players || []).find((p) => p.name === shooterName);
  const contactShooter = (contactFrame.players || []).find((p) => p.name === shooterName);
  const ballPos = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;

  // Determine camera focus
  const focus = React.useMemo(() => {
    const base = shooter?.parts.pelvis ? toThree(shooter.parts.pelvis) : new THREE.Vector3();
    const t = interpolate(phase.localFrame, [0, PHASE_FRAMES], [0, 1], {easing: Easing.inOut(Easing.cubic)});
    if (phase.id === "approach") {
      return base.clone().add(new THREE.Vector3(0, -0.5, 0));
    }
    if (phase.id === "coil") {
      return base.clone().add(new THREE.Vector3(0, 0.5, 0));
    }
    if (phase.id === "contact") {
      const b = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : base;
      return b.clone().lerp(base, 0.5);
    }
    if (phase.id === "carry") {
      return base.clone().add(new THREE.Vector3(0, 0, 0));
    }
    if (phase.id === "output") {
      return ballPos || base;
    }
    return base;
  }, [phase.id, phase.localFrame, shooter, contactFrame, ballPos]);

  return (
    <group>
      <Grid />
      <CameraRig target={focus} phase={phase} />
      
      {/* Players */}
      {(shotFrame.players || []).map((player) => (
        <PlayerSkeleton
          key={`${player.teamCode}-${player.jerseyNumber}`}
          player={player}
          isShooter={player.name === shooterName}
        />
      ))}
      
      {/* Ball */}
      {ballPos && <mesh position={ballPos}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshStandardMaterial color={COLORS.contact} emissive={COLORS.contact} emissiveIntensity={0.2} />
      </mesh>}

      {/* Annotations */}
      {shooter && <Annotations phase={phase} clip={clip} shotFrame={shotFrame} shooter={shooter} contactShooter={contactShooter} contactFrame={contactFrame} />}
    </group>
  );
};

const Annotations: React.FC<{
  phase: ReturnType<typeof phaseForFrame>;
  clip: Clip;
  shotFrame: ShotFrame;
  shooter: Player;
  contactShooter?: Player;
  contactFrame: ShotFrame;
}> = ({phase, clip, shotFrame, shooter, contactShooter, contactFrame}) => {
  const opacity = interpolate(phase.localFrame, [0, 30, PHASE_FRAMES - 30, PHASE_FRAMES], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <group>
      {phase.id === "approach" && (
        <FootPath clip={clip} endFrame={shotFrame.frameNumber} color={COLORS.strikeFoot} />
      )}
      
      {phase.id === "coil" && (
        <HipShoulderSeparation player={shooter} opacity={opacity} />
      )}
      
      {phase.id === "contact" && (
        <ContactMeasurements shooter={shooter} ballPos={shotFrame.ball?.position} opacity={opacity} />
      )}
      
      {phase.id === "carry" && contactShooter && (
        <FollowThrough ghostShooter={contactShooter} currentShooter={shooter} opacity={opacity} />
      )}
      
      {phase.id === "output" && (
        <BallFlight clip={clip} startFrame={clip.frameRoles.contactFrame || 0} endFrame={shotFrame.frameNumber} color={COLORS.path} opacity={opacity} />
      )}
    </group>
  );
};

// ================= Geometry Components =================

const Grid = () => {
  return (
    <gridHelper args={[100, 100, COLORS.grid, COLORS.grid]} position={[0, -0.01, 0]} />
  );
};

const PlayerSkeleton: React.FC<{player: Player; isShooter: boolean}> = ({player, isShooter}) => {
  const lines = useMemo(() => {
    const segments: THREE.Vector3[] = [];
    BODY_CONNECTIONS.forEach(([p1, p2]) => {
      const v1 = player.parts[p1];
      const v2 = player.parts[p2];
      if (v1 && v2) {
        segments.push(toThree(v1), toThree(v2));
      }
    });
    return segments;
  }, [player]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(lines);
    return g;
  }, [lines]);

  if (!isShooter) {
    return (
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={COLORS.opponents} transparent opacity={0.3} depthTest={false} />
      </lineSegments>
    );
  }

  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={COLORS.shooter} linewidth={2} />
      </lineSegments>
      {/* Joints */}
      {Object.entries(player.parts).map(([name, pos]) => {
        let color = COLORS.shooter;
        let scale = 1;
        if (name.includes("right_foot") || name.includes("right_toe") || name.includes("right_ankle")) {
           color = COLORS.strikeFoot;
           scale = 1.5;
        }
        if (name.includes("left_foot") || name.includes("left_toe") || name.includes("left_ankle")) {
           color = COLORS.plantFoot;
           scale = 1.5;
        }
        return (
          <mesh key={name} position={toThree(pos)}>
            <sphereGeometry args={[0.04 * scale, 8, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
};

const FootPath: React.FC<{clip: Clip; endFrame: number; color: string}> = ({clip, endFrame, color}) => {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const shooterName = clip.shot.player;
    for (let f = clip.frameWindow.start; f <= endFrame; f++) {
      const frame = clip.frames.find(x => x.frameNumber === f);
      const shooter = frame?.players?.find(p => p.name === shooterName);
      if (shooter?.parts.right_toe) {
        pts.push(toThree(shooter.parts.right_toe));
      }
    }
    return pts;
  }, [clip, endFrame]);

  if (points.length < 2) return null;
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  
  return (
    <line>
      <primitive object={geo} attach="geometry" />
      <lineBasicMaterial color={color} linewidth={3} transparent opacity={0.8} />
    </line>
  );
};

const HipShoulderSeparation: React.FC<{player: Player; opacity: number}> = ({player, opacity}) => {
  const sL = player.parts.left_shoulder;
  const sR = player.parts.right_shoulder;
  const hL = player.parts.left_hip;
  const hR = player.parts.right_hip;
  
  if (!sL || !sR || !hL || !hR) return null;
  
  const sL3 = toThree(sL);
  const sR3 = toThree(sR);
  const hL3 = toThree(hL);
  const hR3 = toThree(hR);
  
  return (
    <group>
      {/* Shoulder Axis */}
      <mesh position={sL3.clone().lerp(sR3, 0.5)}>
        <cylinderGeometry args={[0.03, 0.03, sL3.distanceTo(sR3) + 0.4, 8]} />
        <meshBasicMaterial color={COLORS.shoulder} transparent opacity={opacity} />
      </mesh>
      {/* Hip Axis */}
      <mesh position={hL3.clone().lerp(hR3, 0.5)}>
        <cylinderGeometry args={[0.03, 0.03, hL3.distanceTo(hR3) + 0.4, 8]} />
        <meshBasicMaterial color={COLORS.hip} transparent opacity={opacity} />
      </mesh>
      {/* Connectors */}
      <line>
        <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([sL3, hL3])} />
        <lineBasicMaterial color={COLORS.shooter} transparent opacity={opacity * 0.5} />
      </line>
      <line>
        <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([sR3, hR3])} />
        <lineBasicMaterial color={COLORS.shooter} transparent opacity={opacity * 0.5} />
      </line>
    </group>
  );
};

const ContactMeasurements: React.FC<{shooter: Player; ballPos?: Vec3; opacity: number}> = ({shooter, ballPos, opacity}) => {
  if (!ballPos) return null;
  const ball3 = toThree(ballPos);
  const plantToe = shooter.parts.left_toe;
  const strikeToe = shooter.parts.right_toe;
  
  return (
    <group>
      {plantToe && (
        <group>
          <line>
            <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([toThree(plantToe), ball3])} />
            <lineBasicMaterial color={COLORS.plantFoot} linewidth={2} transparent opacity={opacity} />
          </line>
        </group>
      )}
      {strikeToe && (
        <group>
          <line>
            <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([toThree(strikeToe), ball3])} />
            <lineBasicMaterial color={COLORS.strikeFoot} linewidth={2} transparent opacity={opacity} />
          </line>
        </group>
      )}
    </group>
  );
};

const FollowThrough: React.FC<{ghostShooter: Player; currentShooter: Player; opacity: number}> = ({ghostShooter, currentShooter, opacity}) => {
  // Ghost skeleton
  const lines = useMemo(() => {
    const segments: THREE.Vector3[] = [];
    BODY_CONNECTIONS.forEach(([p1, p2]) => {
      const v1 = ghostShooter.parts[p1];
      const v2 = ghostShooter.parts[p2];
      if (v1 && v2) segments.push(toThree(v1), toThree(v2));
    });
    return segments;
  }, [ghostShooter]);
  
  const ghostGeo = new THREE.BufferGeometry().setFromPoints(lines);
  
  // COM Arrow (Pelvis shift)
  const p1 = ghostShooter.parts.pelvis ? toThree(ghostShooter.parts.pelvis) : null;
  const p2 = currentShooter.parts.pelvis ? toThree(currentShooter.parts.pelvis) : null;

  return (
    <group>
      <lineSegments geometry={ghostGeo}>
        <lineBasicMaterial color={COLORS.textMuted} transparent opacity={opacity * 0.5} />
      </lineSegments>
      {p1 && p2 && p1.distanceTo(p2) > 0.1 && (
        <arrowHelper args={[p2.clone().sub(p1).normalize(), p1, p1.distanceTo(p2), COLORS.strikeFoot, 0.2, 0.1]} />
      )}
    </group>
  );
};

const BallFlight: React.FC<{clip: Clip; startFrame: number; endFrame: number; color: string; opacity: number}> = ({clip, startFrame, endFrame, color, opacity}) => {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let f = startFrame; f <= endFrame; f++) {
      const frame = clip.frames.find(x => x.frameNumber === f);
      if (frame?.ball?.position) {
        pts.push(toThree(frame.ball.position));
      }
    }
    return pts;
  }, [clip, startFrame, endFrame]);

  if (points.length < 2) return null;
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  
  return (
    <line>
      <primitive object={geo} attach="geometry" />
      <lineDashedMaterial color={color} linewidth={3} transparent opacity={opacity} dashSize={0.2} gapSize={0.1} />
    </line>
  );
};

// ================= Camera =================

const CameraRig: React.FC<{target: THREE.Vector3; phase: ReturnType<typeof phaseForFrame>}> = ({target, phase}) => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const {camera} = useThree();
  
  useThreeFrame(() => {
    let offset = new THREE.Vector3(5, 2, 5);
    if (phase.id === "approach") offset = new THREE.Vector3(6, 1, 4);
    if (phase.id === "coil") offset = new THREE.Vector3(4, 2, 4);
    if (phase.id === "contact") offset = new THREE.Vector3(3, 0.5, 3);
    if (phase.id === "carry") offset = new THREE.Vector3(5, 1, 5);
    if (phase.id === "output") offset = new THREE.Vector3(-4, 3, 6);
    
    // Smooth transitions between phases wouldn't happen easily like this, 
    // but within a phase we drift slightly.
    const drift = interpolate(phase.localFrame, [0, PHASE_FRAMES], [-0.5, 0.5]);
    offset.x += drift;
    
    const pos = target.clone().add(offset);
    camera.position.lerp(pos, 0.1);
    camera.lookAt(target);
  });
  
  return null;
};

// ================= Overlay =================

const Overlay: React.FC<{clip: Clip; phase: ReturnType<typeof phaseForFrame>}> = ({clip, phase}) => {
  let value = "";
  let implication = "";
  
  if (phase.id === "approach") {
    value = `${Number(clip.features.foot_speed_m_s || 0).toFixed(1)} m/s foot speed`;
    implication = "Clean runway enables maximum limb acceleration.";
  } else if (phase.id === "coil") {
    value = `${Number(clip.features.peak_shoulder_hip_separation_deg || 0).toFixed(1)}° separation`;
    implication = "Torque stored between hips and shoulders.";
  } else if (phase.id === "contact") {
    value = "Strike gap";
    implication = "Short plant-to-ball distance anchors energy transfer.";
  } else if (phase.id === "carry") {
    value = "COM Continuation";
    implication = "Momentum drives through the ball instead of stopping.";
  } else if (phase.id === "output") {
    value = `${Number(clip.features.ball_exit_speed_m_s || 0).toFixed(1)} m/s exit speed`;
    implication = "High power, strong launch angle.";
  }

  const opacity = interpolate(phase.localFrame, [0, 15, PHASE_FRAMES - 15, PHASE_FRAMES], [0, 1, 1, 0]);

  return (
    <div style={{...styles.overlay, opacity}}>
      <div style={styles.panel}>
        <div style={styles.title}>{phase.title}</div>
        <div style={styles.value}>{value}</div>
        <div style={styles.implication}>{implication}</div>
      </div>
    </div>
  );
};

// ================= Helpers =================

function toThree(v: Vec3) {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

const styles = {
  overlay: {
    position: "absolute" as const,
    bottom: 80,
    left: 80,
    display: "flex",
    flexDirection: "column" as const,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  panel: {
    backgroundColor: COLORS.panel,
    padding: "24px 32px",
    borderRadius: "8px",
    borderLeft: `4px solid ${COLORS.strikeFoot}`,
    minWidth: 400,
  },
  title: {
    color: COLORS.textMuted,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  value: {
    color: COLORS.textMain,
    fontSize: 42,
    fontWeight: 600,
    marginBottom: 12,
  },
  implication: {
    color: COLORS.textMain,
    fontSize: 20,
    opacity: 0.9,
    lineHeight: 1.4,
  },
};
