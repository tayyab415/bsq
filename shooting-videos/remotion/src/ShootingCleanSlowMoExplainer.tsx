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
import explainerPair from "../public/explainer-pair.json";

type Vec3 = {x: number; y: number; z: number};
type Ball = {position?: Vec3; velocity?: Vec3};
type Player = {
  name?: string;
  jerseyNumber?: number | string;
  teamCode?: number;
  nearestBallDistance?: number;
  parts: Record<string, Vec3>;
};
type ShotFrame = {frameNumber: number; ball?: Ball | null; players?: Player[]};
type Callout = {label: string; value: string; detail: string};
type Clip = {
  role: "standout" | "constraint";
  matchFolder: string;
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
  frameWindow: {start: number; end: number; contact?: number; physicsExit?: number; impact?: number};
  story: {summary: string; tone: string; callouts: Callout[]};
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

const HOME_COLOR = "#e85d5d";
const AWAY_COLOR = "#80c8ff";
const SHOULDER_COLOR = "#78b7ff";
const HIP_COLOR = "#ffd166";
const PLANT_COLOR = "#c9f36a";
const BALL_COLOR = "#f2bf5e";
const LEFT_COLOR = "#4ea4ff";
const RIGHT_COLOR = "#ff9b42";
const CENTER_COLOR = "#75d6a1";

export const CleanContactSlowMoExplainer = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const {clip, segmentFrame, phase} = activeClip(frame);
  const shotFrame = useMemo(() => frameForSegment(clip, segmentFrame), [clip, segmentFrame]);
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(
    () => cameraForSegment(clip, segmentFrame, shotFrame, contactFrame),
    [clip, contactFrame, segmentFrame, shotFrame],
  );

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#070908"]} />
        <ambientLight intensity={0.78} />
        <hemisphereLight args={["#ffffff", "#17251d", 1.15]} />
        <directionalLight position={[18, 32, -16]} intensity={2.35} />
        <directionalLight position={[-16, 18, 18]} intensity={0.8} />
        <CameraRig position={camera.position} target={camera.target} />
        <ExplainerWorld clip={clip} shotFrame={shotFrame} contactFrame={contactFrame} segmentFrame={segmentFrame} />
      </ThreeCanvas>
      <div style={styles.vignette} />
      <ExplainerOverlay clip={clip} frame={frame} phase={phase} />
    </AbsoluteFill>
  );
};

const ExplainerWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  segmentFrame: number;
}> = ({clip, shotFrame, contactFrame, segmentFrame}) => {
  const shooterName = clip.shot.player;
  const shooter = (shotFrame.players || []).find((player) => player.name === shooterName);
  const contactShooter = (contactFrame.players || []).find((player) => player.name === shooterName);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : null;
  const showMechanics = segmentFrame >= 30 && segmentFrame < 146;

  return (
    <group>
      <Pitch />
      <BallTrail clip={clip} currentFrame={shotFrame.frameNumber} />
      {(shotFrame.players || []).map((player) => (
        <PlayerSkeleton
          key={`${clip.eventId}-${shotFrame.frameNumber}-${player.teamCode}-${player.jerseyNumber}-${player.name}`}
          player={player}
          isShooter={player.name === shooterName}
          muted={segmentFrame >= 34 && segmentFrame < 150}
        />
      ))}
      {ball ? <BallMesh position={ball} /> : null}
      {contactBall ? <ContactRings position={contactBall} /> : null}
      {showMechanics && shooter ? <BodyAxes clip={clip} player={shooter} /> : null}
      {showMechanics && shooter ? <PlantLegOverlay clip={clip} player={shooter} /> : null}
      {showMechanics && contactShooter ? <ContactGhost player={contactShooter} /> : null}
      {shooter && ball ? <ContactProbe player={shooter} ball={ball} /> : null}
      {ball && shotFrame.ball?.velocity ? <VelocityVector ball={ball} velocity={shotFrame.ball.velocity} /> : null}
    </group>
  );
};

const ExplainerOverlay: React.FC<{clip: Clip; frame: number; phase: string}> = ({clip, frame, phase}) => {
  const other = data.clips.find((item) => item.eventId !== clip.eventId) || clip;
  const currentScore = numberValue(clip.score.technique_mechanics_score);
  const otherScore = numberValue(other.score.technique_mechanics_score);
  const p3 = numberValue(clip.score.P3_score);
  const p4 = numberValue(clip.score.P4_score);
  const p5 = numberValue(clip.score.P5_score);
  const separation = clip.story.callouts[0]?.value || "-";
  const plantLateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  const plantScore = numberValue(clip.score.C_plant_lateral);
  const isIntro = frame < 30;
  const isOutro = frame >= 330;
  const isSlowMo = phase === "extended slow-motion release";
  const isContactHold = phase === "contact hold";
  const cue = mechanicCue(clip);

  return (
    <>
      <div style={styles.topBar}>
        <div>
          <div style={styles.eyebrow}>Shooting metric explainer</div>
          <div style={styles.title}>
            {isIntro ? "Why technique scores split" : `${clip.shot.player || "Shot"} / ${clip.role}`}
          </div>
        </div>
        <div style={{...styles.badge, borderColor: clip.role === "standout" ? "rgba(117,214,161,0.55)" : "rgba(255,111,145,0.55)"}}>
          {phase}
        </div>
      </div>

      <div style={styles.storyPanel}>
        <div style={styles.storyKicker}>{clip.matchFolder.replace("_", " ")} / {clip.eventId}</div>
        <div style={styles.storySummary}>{isSlowMo || isContactHold ? cue.headline : clip.story.summary}</div>
        <div style={styles.storyText}>
          {isContactHold ? "Contact hold: read the colored body guides before the shot is released." : isSlowMo ? cue.detail : "Contact freezes first; then the shot releases in extended slow motion."}
        </div>
        <div style={styles.axisLegend}>
          <span style={{...styles.legendDot, background: SHOULDER_COLOR}} />
          Shoulder axis
          <span style={{...styles.legendDot, background: HIP_COLOR, marginLeft: 18}} />
          Hip axis
          <span style={{...styles.legendDot, background: PLANT_COLOR, marginLeft: 18}} />
          Plant leg
        </div>
      </div>

      <div style={styles.coachPanel}>
        <div style={styles.coachTitle}>Mechanics focus</div>
        <CoachCue color={SHOULDER_COLOR} label="Shoulder line" value="upper-body axis" />
        <CoachCue color={HIP_COLOR} label="Hip line" value={`${clip.story.callouts[0]?.value || "-"} separation`} />
        <CoachCue color={PLANT_COLOR} label="Plant base" value={`${formatDistance(numberValue(clip.features.plant_foot_lateral_offset_m))} lateral`} />
      </div>

      <div style={styles.calloutGrid}>
        <MetricCard label="Technique" value={formatScore(currentScore)} detail={clip.role === "standout" ? "clean phase chain" : "mechanics bottleneck"} />
        <MetricCard label="Hip-shoulder" value={separation} detail="peak rotational interval" />
        <MetricCard label="Backswing" value={`P3 ${formatScore(p3)}`} detail={clip.role === "standout" ? "loaded into strike" : "limited preload"} />
        <MetricCard label="Contact" value={`P4 ${formatScore(p4)}`} detail="conversion through ball" />
        <MetricCard label="Plant base" value={formatDistance(plantLateral)} detail={`lateral score ${formatDecimal(plantScore)}`} />
        <MetricCard label="Follow-through" value={`P5 ${formatScore(p5)}`} detail="post-contact continuity" />
      </div>

      <div style={styles.comparisonBand}>
        <ComparisonBar label={data.clips[0].shot.player || "Standout"} value={numberValue(data.clips[0].score.technique_mechanics_score)} active={clip.eventId === data.clips[0].eventId} color="#75d6a1" />
        <ComparisonBar label={data.clips[1].shot.player || "Constraint"} value={numberValue(data.clips[1].score.technique_mechanics_score)} active={clip.eventId === data.clips[1].eventId} color="#ff6f91" />
      </div>

      {isOutro ? (
        <div style={styles.outro}>
          <div style={styles.outroTitle}>Same visual language. Different mechanical story.</div>
          <div style={styles.outroText}>
            The template can now swap in any scored shot from the all-matches output and explain which body phase lifted or limited the shooting technique.
          </div>
        </div>
      ) : null}
    </>
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
      <Line points={rectPoints(-52.5, -34, 105, 68)} color={lineMaterial} opacity={0.62} />
      <Line points={[new THREE.Vector3(0, 0.03, -34), new THREE.Vector3(0, 0.03, 34)]} color={lineMaterial} opacity={0.55} />
      <Line points={circlePoints(0, 0, 9.15)} color={lineMaterial} opacity={0.55} />
      <Line points={rectPoints(-52.5, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.65} />
      <Line points={rectPoints(36, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.65} />
      <Line points={rectPoints(-52.5, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.65} />
      <Line points={rectPoints(47, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.65} />
    </group>
  );
};

const PlayerSkeleton: React.FC<{player: Player; isShooter: boolean; muted: boolean}> = ({player, isShooter, muted}) => {
  const baseColor = player.teamCode === 1 ? HOME_COLOR : AWAY_COLOR;
  if (!isShooter) {
    const opacity = muted ? 0.09 : 0.18;
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
              radius={0.022}
              color={baseColor}
              opacity={opacity}
            />
          );
        })}
      </group>
    );
  }
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
            opacity={1}
          />
        );
      })}
      {Object.entries(player.parts).map(([name, point]) => (
        <mesh key={name} position={toThree(point)}>
          <sphereGeometry args={[jointRadius, 12, 12]} />
          <meshStandardMaterial
            color={jointColor(name)}
            transparent
            opacity={1}
            roughness={0.48}
            emissive="#092014"
          />
        </mesh>
      ))}
    </group>
  );
};

const BodyAxes: React.FC<{clip: Clip; player: Player}> = ({clip, player}) => {
  const leftShoulder = player.parts.left_shoulder;
  const rightShoulder = player.parts.right_shoulder;
  const leftHip = player.parts.left_hip;
  const rightHip = player.parts.right_hip;
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  return (
    <group>
      <Line points={[toThree(leftShoulder), toThree(rightShoulder)]} color={SHOULDER_COLOR} opacity={0.96} />
      <Line points={[toThree(leftHip), toThree(rightHip)]} color={HIP_COLOR} opacity={0.96} />
      <CylinderBetween start={toThree(leftShoulder)} end={toThree(rightHip)} radius={0.018} color="#ffffff" opacity={0.28} />
    </group>
  );
};

const PlantLegOverlay: React.FC<{clip: Clip; player: Player}> = ({clip, player}) => {
  const plantFoot = String(clip.features.plant_foot || "left");
  const knee = player.parts[`${plantFoot}_knee`];
  const ankle = player.parts[`${plantFoot}_ankle`];
  const toe = player.parts[`${plantFoot}_toe`] || player.parts[`${plantFoot}_heel`];
  if (!knee || !ankle || !toe) return null;
  const kneePoint = toThree(knee);
  const anklePoint = toThree(ankle);
  const toePoint = toThree(toe);
  const lateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  return (
    <group>
      <CylinderBetween start={kneePoint} end={anklePoint} radius={0.075} color={PLANT_COLOR} opacity={0.92} />
      <CylinderBetween start={anklePoint} end={toePoint} radius={0.07} color={PLANT_COLOR} opacity={0.92} />
      <mesh position={kneePoint}>
        <sphereGeometry args={[0.18, 18, 18]} />
        <meshBasicMaterial color={PLANT_COLOR} transparent opacity={0.9} />
      </mesh>
      <mesh position={toePoint} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.025, 12, 36]} />
        <meshBasicMaterial color={PLANT_COLOR} transparent opacity={0.9} />
      </mesh>
    </group>
  );
};

const ContactGhost: React.FC<{player: Player}> = ({player}) => (
  <group>
    {BODY_CONNECTIONS.map(([from, to]) => {
      const a = player.parts[from];
      const b = player.parts[to];
      if (!a || !b) return null;
      return <CylinderBetween key={`${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={0.022} color="#ffffff" opacity={0.18} />;
    })}
  </group>
);

const ContactProbe: React.FC<{player: Player; ball: THREE.Vector3}> = ({player, ball}) => {
  const candidates = ["left_toe", "right_toe", "left_ankle", "right_ankle"]
    .map((part) => player.parts[part] ? {part, point: toThree(player.parts[part])} : null)
    .filter((item): item is {part: string; point: THREE.Vector3} => Boolean(item))
    .sort((a, b) => a.point.distanceTo(ball) - b.point.distanceTo(ball));
  const nearest = candidates[0]?.point;
  if (!nearest) return null;
  return (
    <group>
      <Line points={[nearest, ball]} color="#ffffff" opacity={0.5} />
      <mesh position={nearest}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.58} />
      </mesh>
    </group>
  );
};

const BallMesh: React.FC<{position: THREE.Vector3}> = ({position}) => (
  <mesh position={position}>
    <sphereGeometry args={[0.19, 28, 28]} />
    <meshStandardMaterial color={BALL_COLOR} roughness={0.34} emissive="#352207" />
  </mesh>
);

const ContactRings: React.FC<{position: THREE.Vector3}> = ({position}) => (
  <group>
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.48, 0.026, 12, 42]} />
      <meshBasicMaterial color="#ffd166" transparent opacity={0.92} />
    </mesh>
    <mesh position={[position.x, position.y + 0.02, position.z]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.78, 0.012, 12, 64]} />
      <meshBasicMaterial color="#7bb8ff" transparent opacity={0.48} />
    </mesh>
  </group>
);

const BallTrail: React.FC<{clip: Clip; currentFrame: number}> = ({clip, currentFrame}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= currentFrame)
    .map((frame) => frame.ball?.position)
    .filter((position): position is Vec3 => Boolean(position))
    .map(toThree);
  if (points.length < 2) return null;
  return <Line points={points} color="#f7c65f" opacity={0.62} />;
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
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.5} />
    </mesh>
  );
};

const Line: React.FC<{points: THREE.Vector3[]; color: string; opacity: number}> = ({points, color, opacity}) => {
  const line = useMemo(() => {
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({color, transparent: true, opacity}),
    );
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

const activeClip = (frame: number) => {
  if (frame < 36) return {clip: data.clips[0], segmentFrame: 0, phase: "metric setup"};
  if (frame < 286) {
    const segmentFrame = frame - 36;
    return {
      clip: data.clips[0],
      segmentFrame,
      phase: segmentFrame < 30 ? "contact trigger" : segmentFrame < 90 ? "contact hold" : "extended slow-motion release",
    };
  }
  if (frame < 536) {
    const segmentFrame = frame - 286;
    return {
      clip: data.clips[1],
      segmentFrame,
      phase: segmentFrame < 30 ? "contact trigger" : segmentFrame < 90 ? "contact hold" : "extended slow-motion release",
    };
  }
  return {clip: data.clips[1], segmentFrame: 115, phase: "comparison"};
};

const frameForSegment = (clip: Clip, segmentFrame: number): ShotFrame => {
  const contact = contactNumber(clip);
  if (segmentFrame < 34) {
    const frameNumber = interpolate(segmentFrame, [0, 34], [clip.frameWindow.start, contact], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    return interpolatedFrame(clip, frameNumber);
  }
  if (segmentFrame < 100) return nearestFrame(clip, contact);
  const frameNumber = interpolate(segmentFrame, [100, 249], [contact, clip.frameWindow.end], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
  return interpolatedFrame(clip, frameNumber);
};

const cameraForSegment = (clip: Clip, segmentFrame: number, shotFrame: ShotFrame, contactFrame: ShotFrame) => {
  const contactTarget = focusTarget(clip, contactFrame);
  const liveTarget = focusTarget(clip, shotFrame);
  let target = contactTarget.clone();
  let radius = 30;
  let height = 12;
  let angle = -0.9;

  if (segmentFrame < 34) {
    const progress = eased(segmentFrame, 0, 34);
    radius = lerp(28, 10, progress);
    height = lerp(13, 4.2, progress);
    angle = lerp(-1.02, -0.66, progress);
    target = liveTarget.clone().lerp(contactTarget, progress * 0.7);
  } else if (segmentFrame < 100) {
    const progress = eased(segmentFrame, 34, 100);
    target = mechanicsTarget(clip, contactFrame);
    radius = lerp(8.4, 7.6, progress);
    height = lerp(3.2, 3.0, progress);
    angle = lerp(-0.66, -0.58, progress);
  } else {
    const progress = eased(segmentFrame, 100, 249);
    target = mechanicsTarget(clip, shotFrame).lerp(liveTarget, progress * 0.18);
    radius = lerp(7.6, 10.2, progress);
    height = lerp(3.0, 4.3, progress);
    angle = lerp(-0.58, 0.28, progress);
  }

  return {
    position: new THREE.Vector3(target.x + Math.cos(angle) * radius, target.y + height, target.z + Math.sin(angle) * radius),
    target,
  };
};

const focusTarget = (clip: Clip, frame: ShotFrame) => {
  if (frame.ball?.position) return toThree(frame.ball.position);
  const shooter = (frame.players || []).find((player) => player.name === clip.shot.player);
  const pelvis = shooter?.parts.pelvis || shooter?.parts.neck;
  return pelvis ? toThree(pelvis) : new THREE.Vector3(0, 1, 0);
};

const mechanicsTarget = (clip: Clip, frame: ShotFrame) => {
  const shooter = (frame.players || []).find((player) => player.name === clip.shot.player);
  const neck = shooter?.parts.neck ? toThree(shooter.parts.neck) : null;
  const pelvis = shooter?.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
  const plantFoot = String(clip.features.plant_foot || "left");
  const plantToe = shooter?.parts[`${plantFoot}_toe`] ? toThree(shooter.parts[`${plantFoot}_toe`]) : null;
  if (neck && pelvis && plantToe) {
    return neck.clone().lerp(pelvis, 0.45).lerp(plantToe, 0.14);
  }
  if (neck && pelvis) return neck.clone().lerp(pelvis, 0.42);
  return focusTarget(clip, frame);
};

const nearestFrame = (clip: Clip, frameNumber: number) => {
  return clip.frames.reduce((best, frame) => (
    Math.abs(frame.frameNumber - frameNumber) < Math.abs(best.frameNumber - frameNumber) ? frame : best
  ), clip.frames[0]);
};

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
  return {
    position: lerpVec(a.position, b.position, amount),
    velocity: a.velocity && b.velocity ? lerpVec(a.velocity, b.velocity, amount) : a.velocity || b.velocity,
  };
};

const interpolatePlayers = (aPlayers: Player[], bPlayers: Player[], amount: number): Player[] => {
  return aPlayers.map((player) => {
    const match = bPlayers.find((other) => other.name === player.name && other.jerseyNumber === player.jerseyNumber) || player;
    const parts = Object.fromEntries(
      Object.entries(player.parts).map(([name, point]) => [
        name,
        match.parts[name] ? lerpVec(point, match.parts[name], amount) : point,
      ]),
    );
    return {...player, parts};
  });
};

const lerpVec = (a: Vec3, b: Vec3, amount: number): Vec3 => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
  z: lerp(a.z, b.z, amount),
});

const contactNumber = (clip: Clip) => clip.frameRoles.contactFrame || clip.frameWindow.contact || clip.frameWindow.start;
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
const eased = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.16, 1, 0.3, 1),
});
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
const numberValue = (value: string | number | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && !Number.isNaN(parsed) ? parsed : Number.NaN;
};
const formatScore = (value: number) => Number.isNaN(value) ? "-" : String(Math.round(value));
const formatDecimal = (value: number) => Number.isNaN(value) ? "-" : value.toFixed(1);
const formatDistance = (value: number) => Number.isNaN(value) ? "-" : `${Math.abs(value).toFixed(2)}m`;

const mechanicCue = (clip: Clip) => {
  const p3 = numberValue(clip.score.P3_score);
  const p4 = numberValue(clip.score.P4_score);
  const p5 = numberValue(clip.score.P5_score);
  if (p3 < 60) {
    return {
      headline: "Backswing preload is the limiting phase.",
      detail: "The slow-motion contact view keeps the shoulder and hip axes visible so the reduced loading phase can be read directly on the body.",
    };
  }
  if (p4 < 65) {
    return {
      headline: "Contact conversion is where the strike leaks.",
      detail: "The foot-ball line, plant leg, and contact ring stay on screen as the shot unfolds slowly through the ball.",
    };
  }
  if (p5 < 45) {
    return {
      headline: "The follow-through loses continuity after contact.",
      detail: "The close camera follows the shooter after impact so the post-contact body path is visible.",
    };
  }
  return {
    headline: "Shoulders and hips separate, then unwind through contact.",
    detail: "The close slow-motion view keeps the rotational interval, plant base, and foot-ball contact in the same frame.",
  };
};

const CoachCue: React.FC<{color: string; label: string; value: string}> = ({color, label, value}) => (
  <div style={styles.coachCue}>
    <span style={{...styles.coachDot, background: color}} />
    <span style={styles.coachLabel}>{label}</span>
    <span style={styles.coachValue}>{value}</span>
  </div>
);

const MetricCard: React.FC<{label: string; value: string; detail: string}> = ({label, value, detail}) => (
  <div style={styles.metricCard}>
    <div style={styles.metricValue}>{value}</div>
    <div style={styles.metricLabel}>{label}</div>
    <div style={styles.metricDetail}>{detail}</div>
  </div>
);

const ComparisonBar: React.FC<{label: string; value: number; active: boolean; color: string}> = ({label, value, active, color}) => (
  <div style={{...styles.compareItem, opacity: active ? 1 : 0.55}}>
    <div style={styles.compareLabel}>{label}</div>
    <div style={styles.compareTrack}>
      <div style={{...styles.compareFill, width: `${Math.max(0, Math.min(100, value))}%`, background: color}} />
    </div>
    <div style={styles.compareValue}>{formatScore(value)}</div>
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  root: {background: "#070908", color: "#f3f7f2", fontFamily: "Inter, Arial, Helvetica, sans-serif"},
  vignette: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(circle at 50% 48%, rgba(255,255,255,0) 0%, rgba(7,9,8,0.13) 50%, rgba(7,9,8,0.78) 100%)",
    pointerEvents: "none",
  },
  topBar: {
    position: "absolute",
    top: 42,
    left: 54,
    right: 54,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  eyebrow: {color: "#a9b7ad", fontSize: 23, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0},
  title: {marginTop: 7, fontSize: 50, fontWeight: 850, lineHeight: 1.04},
  badge: {
    minWidth: 270,
    textAlign: "right",
    padding: "14px 20px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(7,9,8,0.62)",
    borderRadius: 8,
    fontSize: 24,
    fontWeight: 850,
    textTransform: "uppercase",
  },
  storyPanel: {
    position: "absolute",
    right: 54,
    top: 160,
    width: 485,
    padding: "22px 24px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(7,9,8,0.64)",
    borderRadius: 8,
  },
  storyKicker: {fontSize: 18, color: "#a9b7ad", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0},
  storySummary: {marginTop: 10, fontSize: 30, lineHeight: 1.08, fontWeight: 850},
  storyText: {marginTop: 12, color: "#d8e0db", fontSize: 19, lineHeight: 1.18, fontWeight: 650},
  axisLegend: {marginTop: 16, display: "flex", alignItems: "center", color: "#d8e0db", fontSize: 18, fontWeight: 750},
  legendDot: {display: "inline-block", width: 14, height: 14, borderRadius: 14, marginRight: 8},
  calloutGrid: {position: "absolute", left: 54, bottom: 62, display: "flex", gap: 10},
  metricCard: {
    width: 214,
    minHeight: 104,
    padding: "15px 16px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(7,9,8,0.68)",
    borderRadius: 8,
  },
  metricValue: {fontSize: 30, lineHeight: 1, fontWeight: 900},
  metricLabel: {marginTop: 8, color: "#aab5ad", fontSize: 17, fontWeight: 850, textTransform: "uppercase", letterSpacing: 0},
  metricDetail: {marginTop: 7, color: "#d8e0db", fontSize: 16, lineHeight: 1.15, fontWeight: 650},
  comparisonBand: {
    position: "absolute",
    right: 54,
    bottom: 62,
    width: 470,
    padding: "16px 18px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(7,9,8,0.68)",
    borderRadius: 8,
  },
  coachPanel: {
    position: "absolute",
    left: 54,
    top: 142,
    width: 380,
    padding: "16px 18px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(7,9,8,0.68)",
    borderRadius: 8,
  },
  coachTitle: {fontSize: 19, fontWeight: 900, textTransform: "uppercase", color: "#a9b7ad", marginBottom: 10},
  coachCue: {display: "grid", gridTemplateColumns: "16px 126px 1fr", alignItems: "center", gap: 9, marginTop: 8},
  coachDot: {width: 11, height: 11, borderRadius: 11},
  coachLabel: {fontSize: 18, fontWeight: 850, color: "#f3f7f2"},
  coachValue: {fontSize: 17, fontWeight: 700, color: "#cbd6cf"},
  compareItem: {display: "grid", gridTemplateColumns: "150px 1fr 42px", alignItems: "center", gap: 10, margin: "8px 0"},
  compareLabel: {fontSize: 17, color: "#d8e0db", fontWeight: 800, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"},
  compareTrack: {height: 10, background: "rgba(255,255,255,0.16)", borderRadius: 999, overflow: "hidden"},
  compareFill: {height: "100%", borderRadius: 999},
  compareValue: {fontSize: 20, fontWeight: 900, textAlign: "right"},
  outro: {
    position: "absolute",
    left: 54,
    top: 190,
    width: 560,
    padding: "24px 26px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(7,9,8,0.72)",
    borderRadius: 8,
  },
  outroTitle: {fontSize: 34, fontWeight: 900, lineHeight: 1.05},
  outroText: {marginTop: 12, color: "#d8e0db", fontSize: 22, lineHeight: 1.22, fontWeight: 650},
};
