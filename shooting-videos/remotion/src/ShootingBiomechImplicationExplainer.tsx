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
const SHOOTER_BONE_COLOR = "#f4f6ee";
const SHOOTER_JOINT_COLOR = "#ffffff";
const SHOOTER_GHOST_COLOR = "#eef6ef";
const STANDOUT_TINT = "#75d6a1";
const CONSTRAINT_TINT = "#ff6f91";
const SHOULDER_COLOR = "#3a96ff";
const HIP_COLOR = "#ff8a2c";
const PLANT_COLOR = "#7ed957";
const BALL_COLOR = "#efe0ad";
const BALL_PATH_COLOR = "#f6d32d";
const FOOT_PATH_COLOR = "#b485ff";
const CONTACT_COLOR = "#ff2f6d";

const INTRO_FRAMES = 90;
const CLIP_FRAMES = 540;
const CONTACT_TRIGGER_END = 90;
const CONTACT_HOLD_END = 210;
const MECHANICS_END = 390;
const OUTRO_START = INTRO_FRAMES + CLIP_FRAMES * 2;

export const BiomechImplicationExplainer = () => {
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
  const showMechanics = segmentFrame >= CONTACT_TRIGGER_END - 24 && segmentFrame < CLIP_FRAMES;
  const showPaths = segmentFrame >= CONTACT_TRIGGER_END;
  const focusPoint = contactBall || ball || new THREE.Vector3(0, 0, 0);

  return (
    <group>
      <Pitch focus={focusPoint} />
      {showPaths ? <FullBallPath clip={clip} /> : null}
      {showPaths ? <FootPathTrail clip={clip} currentFrame={shotFrame.frameNumber} /> : null}
      <BallTrail clip={clip} currentFrame={shotFrame.frameNumber} />
      {(shotFrame.players || []).map((player) => (
        <PlayerSkeleton
          key={`${clip.eventId}-${shotFrame.frameNumber}-${player.teamCode}-${player.jerseyNumber}-${player.name}`}
          player={player}
          isShooter={player.name === shooterName}
          muted={segmentFrame >= 34 && segmentFrame < 150}
          tint={clip.role === "standout" ? STANDOUT_TINT : CONSTRAINT_TINT}
        />
      ))}
      {ball ? <BallMesh position={ball} /> : null}
      {contactBall ? <ContactRings position={contactBall} /> : null}
      {contactBall ? <ContactPointMarker position={contactBall} /> : null}
      {showMechanics && shooter ? <BodyAxes clip={clip} player={shooter} /> : null}
      {showMechanics && shooter ? <PlantLegOverlay clip={clip} player={shooter} /> : null}
      {showMechanics && contactShooter ? <ContactGhost player={contactShooter} /> : null}
      {shooter && ball ? <ContactProbe player={shooter} ball={ball} /> : null}
      {segmentFrame >= MECHANICS_END && ball && shotFrame.ball?.velocity ? <VelocityVector ball={ball} velocity={shotFrame.ball.velocity} /> : null}
    </group>
  );
};

const ExplainerOverlay: React.FC<{clip: Clip; frame: number; phase: string}> = ({clip, frame, phase}) => {
  const currentScore = numberValue(clip.score.technique_mechanics_score);
  const separation = clip.story.callouts[0]?.value || "-";
  const plantLateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  const footGap = numberValue(clip.features.min_foot_ball_distance_m);
  const isIntro = frame < INTRO_FRAMES;
  const isOutro = frame >= OUTRO_START;
  const footSpeed = numberValue(clip.features.foot_velocity_into_ball_m_s);
  const ballSpeed = numberValue(clip.features.ball_exit_speed_m_s);
  const isStandout = clip.role === "standout";
  const roleTint = isStandout ? STANDOUT_TINT : CONSTRAINT_TINT;
  const phaseLabel = phaseDisplay(phase);
  const phaseProgress = phaseProgressValue(frame);
  const implication = biomechImplication(clip, phase);
  const activeCues = activeCuesForPhase(phase, {
    contactGap: formatDistance(footGap),
    footSpeed: formatVelocity(footSpeed),
    hipSeparation: separation,
    ballSpeed: formatVelocity(ballSpeed),
    plantLateral: formatDistance(plantLateral),
  });

  return (
    <>
      <div style={styles.topBar}>
        <div style={styles.titleBlock}>
          <div style={styles.eyebrow}>
            Shooting metric explainer
            <span style={{...styles.eyebrowDot, background: roleTint}} />
            <span style={{color: roleTint}}>{isStandout ? "Standout" : "Constraint"}</span>
          </div>
          <div style={styles.title}>
            {isIntro ? "Contact evidence, then shot result" : clip.shot.player || "Shot"}
          </div>
          <div style={styles.subtitle}>{clip.matchFolder.replace(/_/g, " ")} · {clip.eventId}</div>
        </div>
        <div style={styles.phaseChip}>
          <div style={styles.phaseChipLabel}>Phase</div>
          <div style={styles.phaseChipValue}>{phaseLabel}</div>
        </div>
      </div>

      <PhaseProgress progress={phaseProgress} tint={roleTint} />

      {isOutro ? null : (
        <div style={styles.storyPanel}>
          <div style={styles.storyKicker}>{phaseLabel}</div>
          <div style={styles.storySummary}>{isIntro ? "We freeze the strike, read the mechanics, then release the ball." : implication.headline}</div>
          <div style={styles.storyText}>
            {isIntro ? "The viewer sees context, then the overlays explain what each mechanic optimizes." : implication.principle}
          </div>
          {isIntro ? null : (
            <div style={styles.implicationGrid}>
              <InsightLine label="Optimizes" text={implication.optimizes} />
              <InsightLine label="Implication" text={implication.implication} />
              <InsightLine label="Risk" text={implication.risk} />
            </div>
          )}
        </div>
      )}

      {isOutro ? null : (
        <div style={styles.coachPanel}>
          <div style={styles.coachTitle}>Read the overlay</div>
          {activeCues.map((item) => (
            <CoachCue key={item.label} color={item.color} label={item.label} value={item.value} />
          ))}
        </div>
      )}

      <div style={styles.calloutGrid}>
        <MetricCard
          accent={roleTint}
          label="Technique"
          value={formatScore(currentScore)}
          detail={isStandout ? "efficient kinetic chain" : "energy transfer leak"}
          big
        />
        <MetricCard label="Hip-shoulder" value={separation} detail="torque storage" />
        <MetricCard label="Plant base" value={formatDistance(plantLateral)} detail="brace width" />
        <MetricCard label="Contact gap" value={formatDistance(footGap)} detail="strike efficiency" />
      </div>

      <div style={styles.comparisonBand}>
        <div style={styles.comparisonTitle}>Technique score</div>
        <ComparisonBar
          label={data.clips[0].shot.player || "Standout"}
          value={numberValue(data.clips[0].score.technique_mechanics_score)}
          active={clip.eventId === data.clips[0].eventId}
          color={STANDOUT_TINT}
          tag="Standout"
        />
        <ComparisonBar
          label={data.clips[1].shot.player || "Constraint"}
          value={numberValue(data.clips[1].score.technique_mechanics_score)}
          active={clip.eventId === data.clips[1].eventId}
          color={CONSTRAINT_TINT}
          tag="Constraint"
        />
      </div>

      {isOutro ? (
        <div style={styles.outro}>
          <div style={styles.outroKicker}>Comparison · Standout vs Constraint</div>
          <div style={styles.outroTitle}>Same visual language. Different mechanical story.</div>
          <div style={styles.outroText}>
            The template swaps in any scored shot and reads which body phase lifted or limited the strike.
          </div>
          <div style={styles.outroRow}>
            <div style={styles.outroPlayer}>
              <span style={{...styles.outroTag, color: STANDOUT_TINT}}>Standout · {formatScore(numberValue(data.clips[0].score.technique_mechanics_score))}</span>
              <span style={styles.outroName}>{data.clips[0].shot.player}</span>
            </div>
            <div style={styles.outroDivider} />
            <div style={styles.outroPlayer}>
              <span style={{...styles.outroTag, color: CONSTRAINT_TINT}}>Constraint · {formatScore(numberValue(data.clips[1].score.technique_mechanics_score))}</span>
              <span style={styles.outroName}>{data.clips[1].shot.player}</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

const phaseDisplay = (phase: string) => phase.replace(/(^|\s)\S/g, (s) => s.toUpperCase());

const phaseProgressValue = (frame: number) => {
  if (frame < INTRO_FRAMES) return frame / INTRO_FRAMES * 0.04;
  if (frame < INTRO_FRAMES + CLIP_FRAMES) return 0.04 + ((frame - INTRO_FRAMES) / CLIP_FRAMES) * 0.46;
  if (frame < OUTRO_START) return 0.5 + ((frame - INTRO_FRAMES - CLIP_FRAMES) / CLIP_FRAMES) * 0.46;
  return 1;
};

type CueItem = {color: string; label: string; value: string};
const activeCuesForPhase = (
  phase: string,
  values: {contactGap: string; footSpeed: string; hipSeparation: string; ballSpeed: string; plantLateral: string},
): CueItem[] => {
  if (phase === "approach to contact") {
    return [
      {color: SHOOTER_BONE_COLOR, label: "Subject", value: "body chain"},
      {color: FOOT_PATH_COLOR, label: "Strike foot", value: "swing timing"},
      {color: CONTACT_COLOR, label: "Contact point", value: "release trigger"},
    ];
  }
  if (phase === "contact hold") {
    return [
      {color: CONTACT_COLOR, label: "Contact gap", value: `${values.contactGap} efficiency`},
      {color: PLANT_COLOR, label: "Plant base", value: "brace + balance"},
      {color: SHOULDER_COLOR, label: "Shoulder axis", value: "delayed rotation"},
      {color: HIP_COLOR, label: "Hip axis", value: "pelvis release"},
    ];
  }
  if (phase === "mechanics breakdown") {
    return [
      {color: SHOULDER_COLOR, label: "Shoulder axis", value: "keeps torque loaded"},
      {color: HIP_COLOR, label: "Hip axis", value: `${values.hipSeparation} storage`},
      {color: FOOT_PATH_COLOR, label: "Foot path", value: "clean swing plane"},
      {color: PLANT_COLOR, label: "Plant base", value: "stable brace"},
    ];
  }
  if (phase === "release path") {
    return [
      {color: BALL_PATH_COLOR, label: "Ball path", value: `${values.ballSpeed} output`},
      {color: FOOT_PATH_COLOR, label: "Foot path", value: "follow-through transfer"},
      {color: CONTACT_COLOR, label: "Contact point", value: "energy handoff"},
    ];
  }
  return [
    {color: SHOOTER_BONE_COLOR, label: "Subject", value: "neutral skeleton"},
    {color: CONTACT_COLOR, label: "Contact point", value: "color reserved for impact"},
  ];
};

const PhaseProgress: React.FC<{progress: number; tint: string}> = ({progress, tint}) => {
  const segments = [
    {pct: 4, label: "Intro"},
    {pct: 50, label: "Standout"},
    {pct: 96, label: "Constraint"},
  ];
  return (
    <div style={styles.progressTrack}>
      {segments.map((segment) => (
        <div key={segment.label} style={{...styles.progressTick, left: `${segment.pct}%`}} />
      ))}
      <div style={{...styles.progressFill, width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: tint}} />
    </div>
  );
};

const Pitch: React.FC<{focus: THREE.Vector3}> = ({focus}) => {
  const lineMaterial = "#cbd3c5";
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial color="#1d4a30" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[focus.x, -0.025, focus.z]}>
        <circleGeometry args={[5.2, 64]} />
        <meshBasicMaterial color="#2c6240" transparent opacity={0.55} />
      </mesh>
      <Line points={rectPoints(-52.5, -34, 105, 68)} color={lineMaterial} opacity={0.34} />
      <Line points={[new THREE.Vector3(0, 0.03, -34), new THREE.Vector3(0, 0.03, 34)]} color={lineMaterial} opacity={0.3} />
      <Line points={circlePoints(0, 0, 9.15)} color={lineMaterial} opacity={0.3} />
      <Line points={rectPoints(-52.5, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.36} />
      <Line points={rectPoints(36, -20.16, 16.5, 40.32)} color={lineMaterial} opacity={0.36} />
      <Line points={rectPoints(-52.5, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.36} />
      <Line points={rectPoints(47, -9.16, 5.5, 18.32)} color={lineMaterial} opacity={0.36} />
    </group>
  );
};

const PlayerSkeleton: React.FC<{player: Player; isShooter: boolean; muted: boolean; tint: string}> = ({player, isShooter, muted, tint}) => {
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
  const haloOpacity = muted ? 0.1 : 0.18;
  const bonesOpacity = 1;
  const jointOpacity = 1;
  const boneRadius = 0.052;
  const jointRadius = 0.092;
  const haloRadius = 0.105;
  return (
    <group>
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        return (
          <CylinderBetween
            key={`halo-${from}-${to}`}
            start={toThree(a)}
            end={toThree(b)}
            radius={haloRadius}
            color={tint}
            opacity={haloOpacity}
          />
        );
      })}
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        return (
          <CylinderBetween
            key={`bone-${from}-${to}`}
            start={toThree(a)}
            end={toThree(b)}
            radius={boneRadius}
            color={SHOOTER_BONE_COLOR}
            opacity={bonesOpacity}
          />
        );
      })}
      {Object.entries(player.parts).map(([name, point]) => {
        const isShoulder = name === "left_shoulder" || name === "right_shoulder";
        const isHip = name === "left_hip" || name === "right_hip";
        const jointColor = isShoulder ? SHOULDER_COLOR : isHip ? HIP_COLOR : SHOOTER_JOINT_COLOR;
        const useEmissive = isShoulder || isHip;
        return (
          <mesh key={name} position={toThree(point)}>
            <sphereGeometry args={[jointRadius, 14, 14]} />
            <meshStandardMaterial
              color={jointColor}
              transparent
              opacity={jointOpacity}
              roughness={0.4}
              emissive={useEmissive ? jointColor : "#101510"}
              emissiveIntensity={useEmissive ? 0.45 : 0.25}
            />
          </mesh>
        );
      })}
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
      return <CylinderBetween key={`${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={0.022} color={SHOOTER_GHOST_COLOR} opacity={0.18} />;
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
      <torusGeometry args={[0.52, 0.032, 14, 48]} />
      <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.95} />
    </mesh>
    <mesh position={[position.x, position.y + 0.02, position.z]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.86, 0.014, 12, 64]} />
      <meshBasicMaterial color={SHOULDER_COLOR} transparent opacity={0.42} />
    </mesh>
  </group>
);

const ContactPointMarker: React.FC<{position: THREE.Vector3}> = ({position}) => (
  <group>
    <mesh position={position}>
      <sphereGeometry args={[0.075, 16, 16]} />
      <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.95} />
    </mesh>
  </group>
);

const FullBallPath: React.FC<{clip: Clip}> = ({clip}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact)
    .map((frame) => frame.ball?.position)
    .filter((position): position is Vec3 => Boolean(position))
    .map(toThree);
  if (points.length < 2) return null;
  return (
    <group>
      <Line points={points} color={BALL_PATH_COLOR} opacity={0.24} />
      {points.filter((_, index) => index % 8 === 0).map((point, index) => (
        <mesh key={`future-ball-${index}`} position={point}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color={BALL_PATH_COLOR} transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
};

const BallTrail: React.FC<{clip: Clip; currentFrame: number}> = ({clip, currentFrame}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= currentFrame)
    .map((frame) => frame.ball?.position)
    .filter((position): position is Vec3 => Boolean(position))
    .map(toThree);
  if (points.length < 2) return null;
  return (
    <group>
      <Line points={points} color={BALL_PATH_COLOR} opacity={0.82} />
      {points.filter((_, index) => index % 5 === 0).map((point, index) => (
        <mesh key={`live-ball-${index}`} position={point}>
          <sphereGeometry args={[0.075, 12, 12]} />
          <meshBasicMaterial color={BALL_PATH_COLOR} transparent opacity={0.66} />
        </mesh>
      ))}
    </group>
  );
};

const FootPathTrail: React.FC<{clip: Clip; currentFrame: number}> = ({clip, currentFrame}) => {
  const contact = contactNumber(clip);
  const strikeFoot = String(clip.features.inferred_foot || "right");
  const part = `${strikeFoot}_toe`;
  const start = contact - 34;
  const end = Math.max(currentFrame, contact + 8);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= start && frame.frameNumber <= end)
    .map((frame) => (frame.players || []).find((player) => player.name === clip.shot.player)?.parts[part])
    .filter((position): position is Vec3 => Boolean(position))
    .map(toThree);
  if (points.length < 2) return null;
  return (
    <group>
      <Line points={points} color={FOOT_PATH_COLOR} opacity={0.78} />
      {points.filter((_, index) => index % 4 === 0).map((point, index) => (
        <mesh key={`foot-path-${index}`} position={point}>
          <sphereGeometry args={[0.06, 10, 10]} />
          <meshBasicMaterial color={FOOT_PATH_COLOR} transparent opacity={0.72} />
        </mesh>
      ))}
    </group>
  );
};

const VelocityVector: React.FC<{ball: THREE.Vector3; velocity: Vec3}> = ({ball, velocity}) => {
  const end = ball.clone().add(new THREE.Vector3(velocity.x, velocity.z, -velocity.y).multiplyScalar(0.16));
  return (
    <group>
      <Line points={[ball, end]} color={CONTACT_COLOR} opacity={0.9} />
      <mesh position={end}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color={CONTACT_COLOR} />
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
  if (frame < INTRO_FRAMES) return {clip: data.clips[0], segmentFrame: 0, phase: "metric setup"};
  if (frame < INTRO_FRAMES + CLIP_FRAMES) {
    const segmentFrame = frame - INTRO_FRAMES;
    return {
      clip: data.clips[0],
      segmentFrame,
      phase: phaseForSegment(segmentFrame),
    };
  }
  if (frame < OUTRO_START) {
    const segmentFrame = frame - INTRO_FRAMES - CLIP_FRAMES;
    return {
      clip: data.clips[1],
      segmentFrame,
      phase: phaseForSegment(segmentFrame),
    };
  }
  return {clip: data.clips[1], segmentFrame: MECHANICS_END + 45, phase: "comparison"};
};

const phaseForSegment = (segmentFrame: number) => {
  if (segmentFrame < CONTACT_TRIGGER_END) return "approach to contact";
  if (segmentFrame < CONTACT_HOLD_END) return "contact hold";
  if (segmentFrame < MECHANICS_END) return "mechanics breakdown";
  return "release path";
};

const frameForSegment = (clip: Clip, segmentFrame: number): ShotFrame => {
  const contact = contactNumber(clip);
  if (segmentFrame < CONTACT_TRIGGER_END) {
    const frameNumber = interpolate(segmentFrame, [0, CONTACT_TRIGGER_END], [clip.frameWindow.start, contact], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
    return interpolatedFrame(clip, frameNumber);
  }
  if (segmentFrame < CONTACT_HOLD_END) return nearestFrame(clip, contact);
  if (segmentFrame < MECHANICS_END) {
    const frameNumber = interpolate(segmentFrame, [CONTACT_HOLD_END, MECHANICS_END], [Math.max(clip.frameWindow.start, contact - 4), Math.min(clip.frameWindow.end, contact + 10)], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.0, 0.2, 1),
    });
    return interpolatedFrame(clip, frameNumber);
  }
  const frameNumber = interpolate(segmentFrame, [MECHANICS_END, CLIP_FRAMES], [Math.min(clip.frameWindow.end, contact + 10), clip.frameWindow.end], {
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
  let radius = 13;
  let height = 6;
  let angle = -0.7;

  if (segmentFrame < CONTACT_TRIGGER_END) {
    const progress = eased(segmentFrame, 0, CONTACT_TRIGGER_END);
    radius = lerp(9.6, 6.4, progress);
    height = lerp(4.8, 3.7, progress);
    angle = lerp(-0.82, -0.62, progress);
    target = liveTarget.clone().lerp(contactTarget, progress * 0.7);
  } else if (segmentFrame < CONTACT_HOLD_END) {
    const progress = eased(segmentFrame, CONTACT_TRIGGER_END, CONTACT_HOLD_END);
    target = mechanicsTarget(clip, contactFrame);
    radius = lerp(6.3, 5.6, progress);
    height = lerp(3.5, 3.2, progress);
    angle = lerp(-0.62, -0.56, progress);
  } else if (segmentFrame < MECHANICS_END) {
    const progress = eased(segmentFrame, CONTACT_HOLD_END, MECHANICS_END);
    target = mechanicsTarget(clip, shotFrame);
    radius = lerp(5.6, 6.6, progress);
    height = lerp(3.2, 3.8, progress);
    angle = lerp(-0.56, -0.28, progress);
  } else {
    const progress = eased(segmentFrame, MECHANICS_END, CLIP_FRAMES);
    target = mechanicsTarget(clip, shotFrame).lerp(liveTarget, progress * 0.22);
    radius = lerp(6.6, 9.6, progress);
    height = lerp(3.8, 4.7, progress);
    angle = lerp(-0.28, 0.22, progress);
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
const formatVelocity = (value: number) => Number.isNaN(value) ? "-" : `${value.toFixed(1)} m/s`;

type BiomechImplication = {
  headline: string;
  principle: string;
  optimizes: string;
  implication: string;
  risk: string;
};

const biomechImplication = (clip: Clip, phase: string): BiomechImplication => {
  const separation = clip.story.callouts[0]?.value || "-";
  const plant = formatDistance(numberValue(clip.features.plant_foot_lateral_offset_m));
  const footGap = formatDistance(numberValue(clip.features.min_foot_ball_distance_m));
  const p3 = numberValue(clip.score.P3_score);
  const p4 = numberValue(clip.score.P4_score);
  const p5 = numberValue(clip.score.P5_score);
  const isConstraint = clip.role === "constraint";

  if (phase === "approach to contact") {
    return {
      headline: "The approach sets the body chain before the strike.",
      principle: "A good shot is not only fast foot speed. The plant step, pelvis, trunk, and swing foot need to arrive in a useful order.",
      optimizes: "Timing into the ball: the strike foot can accelerate without the upper body collapsing early.",
      implication: isConstraint
        ? "The lower technique score suggests the body is arriving less cleanly, so later contact has less stable support."
        : "The high technique score suggests the body is organized before contact, giving the strike a cleaner runway.",
      risk: "If approach timing is late, the player reaches for the ball and loses controlled rotation.",
    };
  }

  if (phase === "contact hold") {
    return {
      headline: `Contact quality is about transfer, not just touching the ball.`,
      principle: `The ${footGap} foot-ball gap and ${plant} plant base describe whether the player can brace and pass energy through the ball.`,
      optimizes: "Clean impulse: the foot meets the ball near the intended strike zone while the plant leg absorbs rotation.",
      implication: isConstraint
        ? "The larger contact gap means the foot is less connected to the ball, so some force becomes correction instead of shot output."
        : "The tight contact gap keeps the strike compact, so more of the swing can become ball speed and direction.",
      risk: "A loose contact point often creates mishit risk, unstable ankle angle, and reduced placement control.",
    };
  }

  if (phase === "mechanics breakdown") {
    return {
      headline: `Hip-shoulder separation stores rotational energy before release.`,
      principle: `${separation} separation means the pelvis can start unwinding while the shoulders delay, creating a stretch-shortening effect through the trunk.`,
      optimizes: "Torque storage: hips lead, shoulders follow, then the foot arrives through the ball.",
      implication: isConstraint || p3 < 65
        ? "The metric can look large but still underperform if backswing and plant stability do not let that rotation release cleanly."
        : "The interval supports a strong phase chain: load, brace, unwind, then strike.",
      risk: "Too little separation leaves power on the table; too much without control can pull the shot off line.",
    };
  }

  if (phase === "release path") {
    return {
      headline: "The follow-through shows whether the chain stayed connected after contact.",
      principle: `P4 contact is ${formatScore(p4)} and P5 follow-through is ${formatScore(p5)}, so the release path tells us if the contact mechanics continued into the shot output.`,
      optimizes: "Directional transfer: the foot path and ball path should agree after contact.",
      implication: isConstraint || p5 < 60
        ? "The lower follow-through score points to energy bleeding after strike, which can reduce continuity and placement."
        : "The strong follow-through keeps momentum moving through the ball instead of stopping at impact.",
      risk: "If the body stalls after contact, the shot can still leave fast but become less repeatable.",
    };
  }

  return {
    headline: "Same metrics, different biomechanical consequences.",
    principle: `Backswing ${formatScore(p3)}, contact ${formatScore(p4)}, and follow-through ${formatScore(p5)} explain how the shot was built, transferred, and finished.`,
    optimizes: "A connected chain from preload to release.",
    implication: "Use the same overlays to compare which phase lifted or limited the outcome.",
    risk: "A single high value can hide a weak link if the phases do not connect.",
  };
};

const phaseCue = (clip: Clip, phase: string) => {
  const base = mechanicCue(clip);
  const separation = clip.story.callouts[0]?.value || "-";
  const plant = formatDistance(numberValue(clip.features.plant_foot_lateral_offset_m));
  const footGap = formatDistance(numberValue(clip.features.min_foot_ball_distance_m));
  if (phase === "approach to contact") {
    return {
      headline: "The camera settles before contact so the strike can be read clearly.",
      detail: "The shooter is tracked into the ball, then the frame slows down before the foot-ball relationship disappears.",
    };
  }
  if (phase === "contact hold") {
    return {
      headline: "Freeze at contact: contact point, plant base, shoulder axis, hip axis.",
      detail: `The pink marker locks the point of contact. Plant base is ${plant}; foot-ball gap is ${footGap}; the neutral skeleton keeps the overlay colors readable.`,
    };
  }
  if (phase === "mechanics breakdown") {
    return {
      headline: "Now read the body: shoulders rotate against the hips before release.",
      detail: `Blue is the shoulder line, orange is the hip line, and the interval reaches ${separation}. Purple traces the strike-foot path into the ball.`,
    };
  }
  if (phase === "release path") {
    return {
      headline: "Release the shot slowly: foot path becomes ball path.",
      detail: "The gold trail shows where the ball travels after contact while the shooter stays close enough to read follow-through and balance.",
    };
  }
  return {
    headline: base.headline,
    detail: "The final comparison keeps the same visual grammar so strong mechanics and limiting mechanics are easier to separate.",
  };
};

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

const InsightLine: React.FC<{label: string; text: string}> = ({label, text}) => (
  <div style={styles.insightLine}>
    <div style={styles.insightLabel}>{label}</div>
    <div style={styles.insightText}>{text}</div>
  </div>
);

const CoachCue: React.FC<{color: string; label: string; value: string}> = ({color, label, value}) => (
  <div style={styles.coachCue}>
    <span style={{...styles.coachDot, background: color}} />
    <span style={styles.coachLabel}>{label}</span>
    <span style={styles.coachValue}>{value}</span>
  </div>
);

const MetricCard: React.FC<{label: string; value: string; detail: string; accent?: string; big?: boolean}> = ({
  label,
  value,
  detail,
  accent,
  big,
}) => (
  <div style={{...styles.metricCard, ...(big ? styles.metricCardBig : null), borderColor: accent ? accent : "rgba(255,255,255,0.16)"}}>
    {accent ? <div style={{...styles.metricAccent, background: accent}} /> : null}
    <div style={{...styles.metricValue, ...(big ? {fontSize: 56} : null), color: accent || "#f3f7f2"}}>{value}</div>
    <div style={styles.metricLabel}>{label}</div>
    <div style={styles.metricDetail}>{detail}</div>
  </div>
);

const ComparisonBar: React.FC<{label: string; value: number; active: boolean; color: string; tag: string}> = ({label, value, active, color, tag}) => (
  <div style={{...styles.compareItem, opacity: active ? 1 : 0.45}}>
    <div style={styles.compareNameBlock}>
      <div style={{...styles.compareTag, color}}>{tag}</div>
      <div style={styles.compareLabel}>{label}</div>
    </div>
    <div style={styles.compareTrack}>
      <div style={{...styles.compareFill, width: `${Math.max(0, Math.min(100, value))}%`, background: color}} />
    </div>
    <div style={{...styles.compareValue, color: active ? color : "#f3f7f2"}}>{formatScore(value)}</div>
  </div>
);

const PANEL_BG = "rgba(8,12,10,0.74)";
const PANEL_BORDER = "1px solid rgba(255,255,255,0.12)";

const styles: Record<string, React.CSSProperties> = {
  root: {background: "#070908", color: "#f3f7f2", fontFamily: "Inter, Arial, Helvetica, sans-serif"},
  vignette: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(ellipse at 50% 52%, rgba(255,255,255,0) 0%, rgba(7,9,8,0.05) 55%, rgba(7,9,8,0.55) 100%)",
    pointerEvents: "none",
  },
  topBar: {
    position: "absolute",
    top: 36,
    left: 54,
    right: 54,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
  },
  titleBlock: {display: "flex", flexDirection: "column"},
  eyebrow: {
    color: "#9ba7a0",
    fontSize: 18,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  eyebrowDot: {display: "inline-block", width: 9, height: 9, borderRadius: 9, marginLeft: 8},
  title: {marginTop: 6, fontSize: 52, fontWeight: 850, lineHeight: 1.02, letterSpacing: -0.5},
  subtitle: {marginTop: 6, color: "#9ba7a0", fontSize: 17, fontWeight: 600, letterSpacing: 0.4},
  phaseChip: {
    minWidth: 230,
    padding: "12px 18px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 10,
    textAlign: "right",
  },
  phaseChipLabel: {fontSize: 13, color: "#9ba7a0", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4},
  phaseChipValue: {marginTop: 4, fontSize: 22, fontWeight: 850, letterSpacing: 0.2},
  progressTrack: {
    position: "absolute",
    top: 178,
    left: 54,
    right: 54,
    height: 6,
    background: "rgba(255,255,255,0.09)",
    borderRadius: 999,
    overflow: "visible",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 999,
    transition: "none",
    boxShadow: "none",
  },
  progressTick: {
    position: "absolute",
    width: 2,
    height: 12,
    top: -3,
    background: "rgba(255,255,255,0.28)",
    borderRadius: 2,
  },
  storyPanel: {
    position: "absolute",
    right: 54,
    top: 210,
    width: 610,
    padding: "20px 24px 22px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 12,
  },
  storyKicker: {fontSize: 13, color: "#9ba7a0", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4},
  storySummary: {marginTop: 8, fontSize: 25, lineHeight: 1.08, fontWeight: 850},
  storyText: {marginTop: 10, color: "#d7dfda", fontSize: 16, lineHeight: 1.28, fontWeight: 650},
  implicationGrid: {marginTop: 15, display: "grid", gap: 9},
  insightLine: {display: "grid", gridTemplateColumns: "112px 1fr", gap: 12, alignItems: "start"},
  insightLabel: {fontSize: 12, color: "#9ba7a0", fontWeight: 900, textTransform: "uppercase", letterSpacing: 1.1},
  insightText: {fontSize: 15, color: "#edf4ef", lineHeight: 1.24, fontWeight: 620},
  coachPanel: {
    position: "absolute",
    left: 54,
    top: 210,
    width: 380,
    padding: "16px 20px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 12,
  },
  coachTitle: {fontSize: 13, fontWeight: 800, textTransform: "uppercase", color: "#9ba7a0", letterSpacing: 1.4, marginBottom: 10},
  coachCue: {display: "grid", gridTemplateColumns: "14px 110px 1fr", alignItems: "center", gap: 10, marginTop: 9},
  coachDot: {width: 10, height: 10, borderRadius: 10},
  coachLabel: {fontSize: 16, fontWeight: 800, color: "#f3f7f2", letterSpacing: 0.1},
  coachValue: {fontSize: 15, fontWeight: 600, color: "#bcc7c0"},
  calloutGrid: {position: "absolute", left: 54, bottom: 56, display: "flex", gap: 12, alignItems: "stretch"},
  metricCard: {
    width: 184,
    minHeight: 110,
    padding: "14px 16px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 12,
    position: "relative",
    overflow: "hidden",
  },
  metricCardBig: {width: 220, borderWidth: 1},
  metricAccent: {position: "absolute", top: 0, left: 0, height: 3, width: "100%"},
  metricValue: {fontSize: 34, lineHeight: 1, fontWeight: 900, letterSpacing: -0.5},
  metricLabel: {marginTop: 10, color: "#9ba7a0", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2},
  metricDetail: {marginTop: 6, color: "#cdd6cf", fontSize: 14, lineHeight: 1.25, fontWeight: 500},
  comparisonBand: {
    position: "absolute",
    right: 54,
    bottom: 56,
    width: 460,
    padding: "16px 18px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 12,
  },
  comparisonTitle: {
    fontSize: 13,
    color: "#9ba7a0",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  compareItem: {display: "grid", gridTemplateColumns: "150px 1fr 44px", alignItems: "center", gap: 12, margin: "7px 0"},
  compareNameBlock: {display: "flex", flexDirection: "column", overflow: "hidden"},
  compareTag: {fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2},
  compareLabel: {fontSize: 15, color: "#e6ece6", fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"},
  compareTrack: {height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 999, overflow: "hidden"},
  compareFill: {height: "100%", borderRadius: 999},
  compareValue: {fontSize: 22, fontWeight: 900, textAlign: "right"},
  outro: {
    position: "absolute",
    left: 54,
    right: 54,
    top: 210,
    padding: "26px 30px",
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 12,
  },
  outroKicker: {fontSize: 13, color: "#9ba7a0", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4},
  outroTitle: {marginTop: 8, fontSize: 38, fontWeight: 900, lineHeight: 1.05, letterSpacing: -0.5},
  outroText: {marginTop: 12, color: "#cdd6cf", fontSize: 19, lineHeight: 1.32, fontWeight: 500, maxWidth: 760},
  outroRow: {marginTop: 22, display: "flex", alignItems: "stretch", gap: 26},
  outroPlayer: {display: "flex", flexDirection: "column", gap: 4},
  outroTag: {fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4},
  outroName: {fontSize: 22, fontWeight: 850, color: "#f3f7f2"},
  outroDivider: {width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.14)"},
};
