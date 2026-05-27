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
import {groundedClipBundle} from "./groundedClipData";
import {GroundedBackswingSvgOverlay} from "./GroundedBackswingSvgOverlay";
import {GroundedContactSvgOverlay} from "./GroundedContactSvgOverlay";
import {GroundedContextSvgOverlay} from "./GroundedContextSvgOverlay";
import {GroundedFloatingMetricOverlay} from "./GroundedFloatingMetricOverlay";
import {buildGroundedShotPlan} from "./groundedShotAnnotationPlan";
import {subtitleCuesToCaptions} from "./groundedCaptions";
import {GroundedPreRollSlate, GroundedPostRollSlate} from "./GroundedBookendSlates";
import {GroundedSubtitleOverlay} from "./GroundedSubtitleOverlay";
import {buildGroundedShotNarrative} from "./groundedShotNarrative";
import {
  PRE_ROLL_FRAMES,
  POST_ROLL_FRAMES,
  groundedExpandedPhaseForFrame,
} from "./groundedContactChoreography";
import {
  coachPhaseDataProgress as groundedCoachPhaseDataProgress,
  coachPhaseForFrame as groundedCoachPhaseForFrame,
  coachPhaseProgress as groundedCoachPhaseProgress,
  COACH_PHASE_FRAME_COUNTS,
  COACH_PHASE_IDS,
  blendFromPreviousPhaseCamera,
  groundedContactCamera,
  impactFlashOpacity,
  isContactFreeze,
  P4_FREEZE_END,
  P4_FOLLOW_END,
  P4_IMPACT_FRAME,
} from "./groundedContactChoreography";
import type {CameraState} from "./projection";
import {chipEntrance} from "./primitives/types";

type Vec3 = {x: number; y: number; z: number};
type Ball = {position?: Vec3; velocity?: Vec3};
type Player = {
  name?: string;
  jerseyNumber?: number | string;
  teamCode?: number;
  parts: Record<string, Vec3>;
  pelvisSpeed?: number;
};
type ShotFrame = {frameNumber: number; ball?: Ball | null; players?: Player[]};
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
  frameWindow: {
    start: number;
    end: number;
    contact?: number;
    physicsExit?: number;
    biomech?: number;
  };
  story?: {
    summary?: string;
    callouts?: Array<{label: string; value: string; detail: string}>;
  };
  frames: ShotFrame[];
};
type ExplainerData = {clips: Clip[]};
type PhaseId = "approach" | "backswing" | "contact" | "follow" | "output";
type PresentationVariant = "closeup" | "split" | "broadcast" | "diagnostic";
type PhaseState = {id: PhaseId; localFrame: number; index: number; absoluteFrame: number};
type CoachPhaseId = "context" | PhaseId;
type CoachPhaseState = {
  id: CoachPhaseId;
  localFrame: number;
  index: number;
  absoluteFrame: number;
  phaseFrames?: number;
};
type ScreenPoint = {x: number; y: number};
type StickerGeometry = {
  shooter?: ScreenPoint;
  ball?: ScreenPoint;
  shotEnd?: ScreenPoint;
  strikeFoot?: ScreenPoint;
  strikeFootBack?: ScreenPoint;
  plantFoot?: ScreenPoint;
  pelvis?: ScreenPoint;
  leftHip?: ScreenPoint;
  rightHip?: ScreenPoint;
  leftShoulder?: ScreenPoint;
  rightShoulder?: ScreenPoint;
  footPath: ScreenPoint[];
  pelvisPath: ScreenPoint[];
  ballPath: ScreenPoint[];
  angleArc: ScreenPoint[];
};

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
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_ankle", "right_toe"],
] as const;

const PHASE_FRAMES = 270;
const TOTAL_FRAMES = PHASE_FRAMES * 5;
const COACH_PHASE_FRAMES = 300;
const COACH_TOTAL_FRAMES = COACH_PHASE_FRAMES * 6;
const ELECTRIC = "#1ee7ff";
const ELECTRIC_DEEP = "#146dff";
const ICE = "#e9fbff";
const MUTED_ICE = "rgba(212, 242, 255, 0.72)";
const VIOLET = "#8d7cff";
const PLANT_BLUE = "#79b8ff";
const BALL_BLUE = "#b7f4ff";
const DARK = "#020712";
const PANEL = "rgba(3, 13, 28, 0.72)";
const GRID = "#27496e";
const SUBJECT_WHITE = "#f8fbff";
const SHOULDER_BLUE = "#3a86ff";
const HIP_GREEN = "#78f6b0";
const MEASURE_CYAN = "#5ee7ff";
const FOOT_VIOLET = "#b18cff";
const OPPONENT_STEEL = "#91b8d7";

const PHASES: Array<{
  id: PhaseId;
  label: string;
  short: string;
  headline: string;
  implication: string;
}> = [
  {
    id: "approach",
    label: "P2 Approach",
    short: "Run-up",
    headline: "The strike foot accelerates into the ball.",
    implication: "A clean runway lets the foot arrive fast without reaching.",
  },
  {
    id: "backswing",
    label: "P3 Backswing",
    short: "Coil",
    headline: "Hips and shoulders separate before release.",
    implication: "That interval stores rotation for the contact frame.",
  },
  {
    id: "contact",
    label: "P4 Contact",
    short: "Impact",
    headline: "The frame freezes on exact spacing.",
    implication: "Short strike-foot gap plus a braced plant gives transfer.",
  },
  {
    id: "follow",
    label: "P5 Follow-through",
    short: "Carry",
    headline: "The pelvis and foot continue through the shot.",
    implication: "Energy keeps moving forward instead of stopping at impact.",
  },
  {
    id: "output",
    label: "P6 Output",
    short: "Flight",
    headline: "The ball path reveals the strike output.",
    implication: "Speed and launch are strong; placement is the tradeoff.",
  },
];

const COACH_PHASES: Array<{
  id: CoachPhaseId;
  code: "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  label: string;
  feature: string;
  weight: number;
}> = [
  {id: "context", code: "P1", label: "Shot context", feature: "xG + pressure frame", weight: 10},
  {id: "approach", code: "P2", label: "Approach runway", feature: "angle + speed", weight: 20},
  {id: "backswing", code: "P3", label: "Backswing coil", feature: "plant base + X-factor", weight: 20},
  {id: "contact", code: "P4", label: "Impact transfer", feature: "gap + velocity ratio", weight: 30},
  {id: "follow", code: "P5", label: "Follow-through", feature: "COM continuation", weight: 10},
  {id: "output", code: "P6", label: "Ball output", feature: "speed + launch", weight: 10},
];

export const PhaseMechanicsCloseupA = () => <PhaseMechanicsBase variant="closeup" />;
export const PhaseMechanicsSplitB = () => <PhaseMechanicsBase variant="split" />;
export const PhaseMechanicsBroadcastC = () => <PhaseMechanicsBase variant="broadcast" />;
export const PhaseMechanicsDiagnosticD = () => <PhaseMechanicsBase variant="diagnostic" />;
export const PhaseMechanicsCoachCutA2 = () => <CoachCutBase />;
export const PhaseMechanicsStickerCutA3 = () => <StickerCutBase />;
export const PhaseMechanicsGroundedA4 = () => <GroundedStickerCutBase />;

const PhaseMechanicsBase: React.FC<{variant: PresentationVariant}> = ({variant}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const clip = data.clips[0];
  const phaseState = phaseForFrame(frame);
  const shotFrame = useMemo(
    () => frameForPhase(clip, phaseState.id, phaseState.localFrame),
    [clip, phaseState.id, phaseState.localFrame],
  );
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(
    () => cameraForPhase(clip, phaseState.id, phaseState.localFrame, shotFrame, contactFrame),
    [clip, contactFrame, phaseState.id, phaseState.localFrame, shotFrame],
  );

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={[DARK]} />
        <ambientLight intensity={0.62} />
        <hemisphereLight args={["#bdeeff", "#030814", 1.05]} />
        <directionalLight position={[12, 18, -10]} intensity={2.6} color="#ecfbff" />
        <directionalLight position={[-10, 7, 8]} intensity={1.4} color={ELECTRIC} />
        <pointLight position={[0, 4, 0]} color={ELECTRIC_DEEP} intensity={2.2} distance={14} />
        <CameraRig position={camera.position} target={camera.target} fov={camera.fov} />
        <MechanicsWorld
          clip={clip}
          shotFrame={shotFrame}
          contactFrame={contactFrame}
          phase={phaseState.id}
          localFrame={phaseState.localFrame}
        />
      </ThreeCanvas>
      <div style={styles.blueGrade} />
      <div style={styles.vignette} />
      <VariantOverlay clip={clip} phaseState={phaseState} variant={variant} />
    </AbsoluteFill>
  );
};

const CoachCutBase: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const clip = data.clips[0];
  const phaseState = coachPhaseForFrame(frame);
  const shotFrame = useMemo(
    () => frameForCoachPhase(clip, phaseState.id, phaseState.localFrame),
    [clip, phaseState.id, phaseState.localFrame],
  );
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(
    () => coachCameraForPhase(clip, phaseState.id, phaseState.localFrame, shotFrame, contactFrame),
    [clip, contactFrame, phaseState.id, phaseState.localFrame, shotFrame],
  );

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={[DARK]} />
        <ambientLight intensity={0.74} />
        <hemisphereLight args={["#d9f7ff", "#020716", 1.18]} />
        <directionalLight position={[11, 18, -9]} intensity={2.55} color="#f7fcff" />
        <directionalLight position={[-9, 8, 9]} intensity={1.5} color={SHOULDER_BLUE} />
        <pointLight position={[0, 3.8, 0]} color={MEASURE_CYAN} intensity={2.1} distance={15} />
        <CameraRig position={camera.position} target={camera.target} fov={camera.fov} />
        <CoachMechanicsWorld
          clip={clip}
          shotFrame={shotFrame}
          contactFrame={contactFrame}
          phaseState={phaseState}
        />
      </ThreeCanvas>
      <div style={styles.coachBlueGrade} />
      <div style={styles.vignette} />
      <CoachCutOverlay clip={clip} phaseState={phaseState} />
    </AbsoluteFill>
  );
};

const StickerCutBase: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const clip = data.clips[0];
  const phaseState = coachPhaseForFrame(frame);
  const shotFrame = useMemo(
    () => frameForCoachPhase(clip, phaseState.id, phaseState.localFrame),
    [clip, phaseState.id, phaseState.localFrame],
  );
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(
    () => coachCameraForPhase(clip, phaseState.id, phaseState.localFrame, shotFrame, contactFrame),
    [clip, contactFrame, phaseState.id, phaseState.localFrame, shotFrame],
  );

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#020815"]} />
        <ambientLight intensity={0.78} />
        <hemisphereLight args={["#dcefff", "#020716", 1.15]} />
        <directionalLight position={[11, 18, -9]} intensity={2.45} color="#f7fcff" />
        <directionalLight position={[-9, 8, 9]} intensity={1.15} color={SHOULDER_BLUE} />
        <CameraRig position={camera.position} target={camera.target} fov={camera.fov} />
        <StickerMechanicsWorld
          clip={clip}
          shotFrame={shotFrame}
          contactFrame={contactFrame}
          phaseState={phaseState}
        />
      </ThreeCanvas>
      <div style={styles.stickerBlueGrade} />
      <div style={styles.vignette} />
      <StickerTelestrationOverlay
        clip={clip}
        shotFrame={shotFrame}
        contactFrame={contactFrame}
        phaseState={phaseState}
        camera={camera}
        width={width}
        height={height}
      />
    </AbsoluteFill>
  );
};

const GroundedStickerCutBase: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const groundedData = groundedClipBundle() as ExplainerData;
  const clip = groundedData.clips[0];
  const shotPlan = useMemo(() => buildGroundedShotPlan(clip), [clip]);
  const narrative = useMemo(() => buildGroundedShotNarrative(clip, shotPlan), [clip, shotPlan]);
  const captions = useMemo(() => subtitleCuesToCaptions(narrative.cues), [narrative.cues]);
  const expanded = groundedExpandedPhaseForFrame(frame);
  const phaseState = groundedCoachPhaseForFrame(frame) as CoachPhaseState;
  const shotFrame = useMemo(
    () => frameForGroundedCoachPhase(clip, phaseState.id, phaseState.localFrame),
    [clip, phaseState.id, phaseState.localFrame],
  );
  const contactFrame = useMemo(() => nearestFrame(clip, contactNumber(clip)), [clip]);
  const camera = useMemo(
    () => groundedA4CameraForPhase(clip, phaseState, shotFrame, contactFrame),
    [clip, contactFrame, phaseState, shotFrame],
  );
  const flash = impactFlashOpacity(phaseState.id === "contact" ? phaseState.localFrame : -1);

  if (expanded.id === "pre") {
    return (
      <GroundedPreRollSlate
        width={width}
        height={height}
        card={narrative.shotCard}
        durationFrames={PRE_ROLL_FRAMES}
      />
    );
  }

  if (expanded.id === "post") {
    return (
      <GroundedPostRollSlate
        width={width}
        height={height}
        verdict={narrative.verdict}
        durationFrames={POST_ROLL_FRAMES}
      />
    );
  }

  return (
    <AbsoluteFill style={styles.root}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#020815"]} />
        <ambientLight intensity={0.82} />
        <hemisphereLight args={["#e4f5ff", "#020716", 1.2]} />
        <directionalLight position={[11, 18, -9]} intensity={2.55} color="#f7fcff" />
        <directionalLight position={[-9, 8, 9]} intensity={1.2} color={SHOULDER_BLUE} />
        <pointLight position={[0, 3.2, 0]} color={MEASURE_CYAN} intensity={1.3} distance={9} />
        <CameraRig position={camera.position} target={camera.target} fov={camera.fov} />
        <GroundedStickerMechanicsWorld
          clip={clip}
          shotFrame={shotFrame}
          contactFrame={contactFrame}
          phaseState={phaseState}
          shotPlan={shotPlan}
        />
      </ThreeCanvas>
      <div style={styles.stickerBlueGrade} />
      <div style={styles.vignette} />
      {phaseState.id === "context" ? (
        <GroundedContextSvgOverlay
          clip={clip}
          shotFrame={shotFrame}
          localFrame={phaseState.localFrame}
          camera={camera}
          width={width}
          height={height}
          plan={shotPlan}
        />
      ) : null}
      {phaseState.id === "contact" && isContactFreeze(phaseState.localFrame) ? (
        <GroundedContactSvgOverlay
          clip={clip}
          contactFrame={contactFrame}
          localFrame={phaseState.localFrame}
          camera={camera}
          width={width}
          height={height}
          freezeMetrics={shotPlan.p4FreezeMetrics}
        />
      ) : null}
      {phaseState.id === "backswing" ? (
        <GroundedBackswingSvgOverlay
          clip={clip}
          shotFrame={shotFrame}
          localFrame={phaseState.localFrame}
          camera={camera}
          width={width}
          height={height}
          p3Mode={shotPlan.p3Mode}
        />
      ) : null}
      {shotPlan.phases[phaseState.id]?.floatingChip ? (
        <GroundedFloatingMetricOverlay
          clip={clip}
          contactFrame={contactFrame}
          phaseId={phaseState.id}
          localFrame={phaseState.localFrame}
          camera={camera}
          width={width}
          height={height}
          chip={shotPlan.phases[phaseState.id].floatingChip}
        />
      ) : null}
      {flash > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at 50% 42%, rgba(200,245,255,0.95), rgba(30,231,255,0.35) 38%, transparent 72%)",
            opacity: flash,
            pointerEvents: "none",
            zIndex: 6,
            mixBlendMode: "screen",
          }}
        />
      ) : null}
      <GroundedSubtitleOverlay captions={captions} />
      <GroundedStickerOverlay
        clip={clip}
        phaseState={phaseState}
        shotPlan={shotPlan}
        groundedTiming
        subtitleMode
      />
    </AbsoluteFill>
  );
};

const StickerMechanicsWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phaseState: CoachPhaseState;
}> = ({clip, shotFrame, contactFrame, phaseState}) => {
  const phase = phaseState.id;
  const progress = coachPhaseProgress(phaseState.localFrame);
  const renderPhase: PhaseId = phase === "context" ? "approach" : phase;
  const frameForBody = phase === "contact" || phase === "backswing" ? contactFrame : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;
  const focus = contactBall || ball || new THREE.Vector3(0, 0, 0);

  return (
    <group>
      <CoachFloor focus={focus} wide={phase === "context" || phase === "output"} />
      {phase !== "context" ? <ReferenceGrid focus={focus} /> : null}
      {phase === "context" ? <ContextPlayers clip={clip} frame={shotFrame} progress={progress} /> : null}
      {phase !== "context" && shooter ? <CoachPlayerSkeleton clip={clip} player={shooter} phase={renderPhase} /> : null}
      {phase === "follow" ? <ContactGhost player={shooterForFrame(clip, contactFrame) || shooter || {parts: {}}} /> : null}
      {ball ? <BallMesh position={ball} phase={renderPhase} /> : null}
      {contactBall && phase === "contact" ? <ContactPulse position={contactBall} progress={progress} /> : null}
      {phase === "output" ? <BallFlightPath clip={clip} progress={progress} /> : null}
      {phase === "output" ? <GoalHint clip={clip} /> : null}
    </group>
  );
};

const GroundedStickerMechanicsWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phaseState: CoachPhaseState;
  shotPlan: ReturnType<typeof buildGroundedShotPlan>;
}> = ({clip, shotFrame, contactFrame, phaseState, shotPlan}) => {
  const phase = phaseState.id;
  const phaseFrames = phaseState.phaseFrames ?? COACH_PHASE_FRAME_COUNTS[phase];
  const progress = groundedCoachPhaseProgress(phaseState.localFrame, phaseFrames);
  const renderPhase: PhaseId = phase === "context" ? "approach" : phase;
  const frameForBody =
    phase === "contact"
      ? isContactFreeze(phaseState.localFrame)
        ? contactFrame
        : shotFrame
      : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const contactShooter = shooterForFrame(clip, contactFrame);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;
  const focus = contactBall || ball || new THREE.Vector3(0, 0, 0);

  return (
    <group>
      <CoachFloor focus={focus} wide={phase === "context" || phase === "output"} turf="grounded" />
      <GroundedPitchContext focus={focus} clip={clip} />
      {phase === "context" ? <ContextPlayers clip={clip} frame={shotFrame} progress={progress} /> : null}
      {shooter?.parts.pelvis && phase !== "output" ? (
        <ShooterGroundSpotlight
          point={groundPoint(toThree(shooter.parts.pelvis), 0.04)}
          progress={phase === "contact" && isContactFreeze(phaseState.localFrame) ? 1 : progress}
        />
      ) : null}
      <GroundedTelestrationWorld
        clip={clip}
        shotFrame={shotFrame}
        contactFrame={contactFrame}
        phaseState={phaseState}
        shotPlan={shotPlan}
      />
      {phase === "follow" ? <GroundedContactGhost player={contactShooter || shooter || {parts: {}}} /> : null}
      {phase !== "context" && shooter ? <CoachPlayerSkeleton clip={clip} player={shooter} phase={renderPhase} /> : null}
      {ball ? <BallMesh position={ball} phase={renderPhase} /> : null}
      {contactBall && phase === "contact" && !isContactFreeze(phaseState.localFrame) ? (
        <ContactPulse position={contactBall} progress={progress} />
      ) : null}
      {phase === "output" ? <GoalHint clip={clip} /> : null}
    </group>
  );
};

const GroundedTelestrationWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phaseState: CoachPhaseState;
  shotPlan: ReturnType<typeof buildGroundedShotPlan>;
}> = ({clip, shotFrame, contactFrame, phaseState, shotPlan}) => {
  const phase = phaseState.id;
  const phaseFrames = phaseState.phaseFrames ?? COACH_PHASE_FRAME_COUNTS[phase];
  const progress = groundedCoachPhaseProgress(phaseState.localFrame, phaseFrames);
  const frameForBody = phase === "contact" ? contactFrame : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const contactShooter = shooterForFrame(clip, contactFrame) || shooter;
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;

  if (phase === "context" && contactBall) {
    return (
      <GroundedContextGraphics
        clip={clip}
        ball={contactBall}
        progress={progress}
        showRangeArcs={shotPlan.p1ShowDistanceArcs}
        emphasizePressure={!shotPlan.p1ShowDistanceArcs}
      />
    );
  }
  if (phase === "approach" && shooter && contactBall) {
    return (
      <GroundedApproachGraphics
        clip={clip}
        player={shooter}
        ball={contactBall}
        progress={progress}
        showTrunkLean={shotPlan.p2ShowTrunkLean}
      />
    );
  }
  if (phase === "backswing") {
    return null;
  }
  if (phase === "contact" && contactShooter && contactBall) {
    if (isContactFreeze(phaseState.localFrame)) {
      return <GroundRing point={groundPoint(contactBall, 0.045)} color={MEASURE_CYAN} radius={0.38} opacity={0.55} />;
    }
    const runupProgress = groundedCoachPhaseProgress(phaseState.localFrame, P4_IMPACT_FRAME);
    return <GroundedContactGraphics clip={clip} player={contactShooter} ball={contactBall} progress={runupProgress} />;
  }
  if (phase === "follow") {
    return (
      <GroundedFollowGraphics
        clip={clip}
        currentFrame={shotFrame.frameNumber}
        progress={progress}
        emphasizeContinuation={shotPlan.weakestPhase === "follow"}
      />
    );
  }
  if (phase === "output" && ball && shotFrame.ball?.velocity) {
    return (
      <GroundedOutputGraphics
        clip={clip}
        ball={ball}
        velocity={shotFrame.ball.velocity}
        progress={progress}
        heroTrajectory={shotPlan.strongestPhase === "output"}
      />
    );
  }
  return null;
};

const GroundedStickerOverlay: React.FC<{
  clip: Clip;
  phaseState: CoachPhaseState;
  shotPlan?: ReturnType<typeof buildGroundedShotPlan>;
  groundedTiming?: boolean;
  /** Hide storyboard panel; phase rail + slim header only (subtitles carry explanation). */
  subtitleMode?: boolean;
}> = ({clip, phaseState, shotPlan, groundedTiming, subtitleMode}) => {
  const frame = useCurrentFrame();
  const phase = COACH_PHASES[phaseState.index];
  const phaseFrames = phaseState.phaseFrames ?? COACH_PHASE_FRAME_COUNTS[phaseState.id];
  const progress = groundedTiming
    ? groundedCoachPhaseProgress(phaseState.localFrame, phaseFrames)
    : coachPhaseProgress(phaseState.localFrame);
  const copy = shotPlan ? shotPlan.phases[phaseState.id] : stickerPhaseCopy(clip, phaseState.id);
  const pop = clamp01(interpolate(progress, [0.18, 0.46], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}));
  const contactFreeze =
    groundedTiming && phaseState.id === "contact" && isContactFreeze(phaseState.localFrame);
  const chromeOpacity = contactFreeze
    ? interpolate(phaseState.localFrame, [P4_IMPACT_FRAME, P4_IMPACT_FRAME + 14], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const hideOnFreeze = new Set(["gap", "foot speed", "transfer"]);
  const stickers = subtitleMode
    ? []
    : contactFreeze
      ? copy.stickers.filter((item) => !hideOnFreeze.has(item.label))
      : copy.stickers;

  return (
    <>
      {!subtitleMode ? (
        <div style={{...styles.stickerHeader, opacity: chromeOpacity}}>
          <div style={styles.stickerKicker}>Ground telestration cut</div>
          <div style={styles.stickerTitle}>{clip.shot.player || "Shooter"}</div>
          <div style={styles.stickerMeta}>{clip.matchFolder.replace(/_/g, " ")} · Event {clip.eventId}</div>
        </div>
      ) : (
        <div style={{...styles.stickerHeader, opacity: chromeOpacity * 0.85, padding: "18px 28px"}}>
          <div style={{...styles.stickerKicker, fontSize: 11}}>{copy.kicker}</div>
          <div style={{...styles.stickerTitle, fontSize: 22}}>{clip.shot.player || "Shooter"}</div>
        </div>
      )}

      <div style={{...styles.stickerPhasePill, opacity: chromeOpacity}}>
        <span style={styles.stickerPhaseCode}>{phase.code}</span>
        <span style={styles.stickerPhaseText}>{phase.label}</span>
      </div>

      {!subtitleMode ? (
        <div style={{...styles.stickerStoryboard, opacity: chromeOpacity}}>
          <div style={styles.stickerStoryKicker}>{copy.kicker}</div>
          <div style={styles.stickerStoryTitle}>{copy.title}</div>
          <div style={styles.stickerStoryText}>{copy.text}</div>
        </div>
      ) : null}

      {stickers.map((item, index) => (
        <StickerBubble
          key={`${item.label}-${index}`}
          label={item.label}
          value={item.value}
          color={item.color}
          x={item.x}
          y={item.y}
          delay={index * 5}
          localFrame={phaseState.localFrame}
          pop={pop}
          springEntrance={groundedTiming}
        />
      ))}

      <div style={{...styles.stickerRail, opacity: chromeOpacity}}>
        {COACH_PHASES.map((item, index) => (
          <div key={item.id} style={styles.stickerRailItem}>
            <div
              style={{
                ...styles.stickerRailDot,
                background: index === phaseState.index ? MEASURE_CYAN : index < phaseState.index ? SHOULDER_BLUE : "rgba(176,202,222,0.22)",
              }}
            />
            <div style={{...styles.stickerRailLabel, color: index === phaseState.index ? ICE : "rgba(225,241,255,0.48)"}}>
              {item.code}
            </div>
          </div>
        ))}
        <div style={{...styles.stickerRailFill, width: `${((phaseState.index + progress) / COACH_PHASES.length) * 100}%`}} />
      </div>

      <div style={{...styles.stickerTick, opacity: 0.42 + Math.sin(frame / 7) * 0.12}} />
    </>
  );
};

const CoachMechanicsWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phaseState: CoachPhaseState;
}> = ({clip, shotFrame, contactFrame, phaseState}) => {
  const phase = phaseState.id;
  const localFrame = phaseState.localFrame;
  const progress = coachPhaseProgress(localFrame);
  const renderPhase: PhaseId = phase === "context" ? "approach" : phase;
  const frameForBody = phase === "contact" || phase === "backswing" ? contactFrame : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const contactShooter = shooterForFrame(clip, contactFrame);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;
  const focus = contactBall || ball || new THREE.Vector3(0, 0, 0);

  return (
    <group>
      <CoachFloor focus={focus} wide={phase === "context" || phase === "output"} />
      {phase === "context" ? <ContextPlayers clip={clip} frame={shotFrame} progress={progress} /> : null}
      {phase !== "context" ? <ReferenceGrid focus={focus} /> : null}
      {phase === "context" && contactBall ? <CoachShotLane clip={clip} ball={contactBall} progress={progress} /> : null}
      {phase === "output" ? <GoalHint clip={clip} /> : null}
      {phase === "output" ? <BallFlightPath clip={clip} progress={progress} /> : null}
      {phase !== "output" && phase !== "context" ? (
        <FootTrail clip={clip} currentFrame={shotFrame.frameNumber} progress={phase === "approach" ? progress : 1} />
      ) : null}
      {phase === "follow" ? <PelvisContinuation clip={clip} currentFrame={shotFrame.frameNumber} progress={progress} /> : null}
      {phase === "follow" ? <FollowFootPath clip={clip} currentFrame={shotFrame.frameNumber} progress={progress} /> : null}
      {contactShooter && phase !== "approach" && phase !== "context" ? <ContactGhost player={contactShooter} /> : null}
      {shooter && phase !== "context" ? <CoachPlayerSkeleton clip={clip} player={shooter} phase={renderPhase} /> : null}
      {ball ? <BallMesh position={ball} phase={renderPhase} /> : null}
      {contactBall && phase !== "output" && phase !== "context" ? <ContactPulse position={contactBall} progress={progress} /> : null}
      {phase === "approach" && shooter && contactBall ? (
        <CoachApproachGraphics clip={clip} player={shooter} ball={contactBall} progress={progress} />
      ) : null}
      {phase === "backswing" && contactShooter ? (
        <CoachBackswingGraphics clip={clip} player={contactShooter} progress={progress} />
      ) : null}
      {phase === "contact" && contactShooter && contactBall ? (
        <CoachContactTransferGraphics clip={clip} player={contactShooter} ball={contactBall} progress={progress} />
      ) : null}
      {phase === "output" && ball && shotFrame.ball?.velocity ? (
        <CoachOutputGraphics clip={clip} ball={ball} velocity={shotFrame.ball.velocity} progress={progress} />
      ) : null}
    </group>
  );
};

const CoachCutOverlay: React.FC<{clip: Clip; phaseState: CoachPhaseState}> = ({clip, phaseState}) => {
  const phase = COACH_PHASES[phaseState.index];
  const progress = coachPhaseProgress(phaseState.localFrame);
  const copy = coachPhaseCopy(clip, phaseState.id);
  const phaseScoreValue = coachPhaseScore(clip, phaseState.id);

  return (
    <>
      <div style={styles.coachHeader}>
        <div style={styles.kicker}>Shooting metric coach cut</div>
        <div style={styles.title}>{clip.shot.player || "Standout shot"}</div>
        <div style={styles.meta}>
          {clip.matchFolder.replace(/_/g, " ")} · Event {clip.eventId} · {String(clip.features.family || clip.score.family || "shot").replace(/_/g, " ")}
        </div>
      </div>

      <div style={styles.coachPhaseBadge}>
        <div style={styles.coachPhaseCode}>{phase.code}</div>
        <div style={styles.coachPhaseName}>{phase.label}</div>
        <div style={styles.coachPhaseFeature}>{phase.feature}</div>
      </div>

      <div style={styles.coachExplanationPanel}>
        <div style={styles.coachPanelKicker}>{copy.kicker}</div>
        <div style={styles.coachPanelTitle}>{copy.headline}</div>
        <div style={styles.coachPanelSub}>{copy.subhead}</div>
        <div style={styles.coachRows}>
          <CoachInsightRow label="Measured" text={copy.measured} />
          <CoachInsightRow label="Visual" text={copy.visual} />
          <CoachInsightRow label="Why it matters" text={copy.why} />
        </div>
      </div>

      <div style={styles.coachMetricShelf}>
        <CoachValueCard label="Phase weight" value={`${phase.weight}%`} helper="BSQ contribution" active />
        <CoachValueCard label="Phase score" value={formatScore(phaseScoreValue)} helper={copy.scoreHelper} />
        {copy.values.map((item) => (
          <CoachValueCard key={item.label} label={item.label} value={item.value} helper={item.helper} />
        ))}
      </div>

      <div style={styles.coachLegend}>
        <LegendDot color={SUBJECT_WHITE} label="body" />
        <LegendDot color={MEASURE_CYAN} label="distance" />
        <LegendDot color={FOOT_VIOLET} label="foot path" />
        <LegendDot color={HIP_GREEN} label="hip axis" />
        <LegendDot color={BALL_BLUE} label="ball path" />
      </div>

      <div style={styles.coachRail}>
        {COACH_PHASES.map((item, index) => (
          <div key={item.id} style={styles.coachRailItem}>
            <div
              style={{
                ...styles.coachRailDot,
                background: index === phaseState.index ? MEASURE_CYAN : index < phaseState.index ? SHOULDER_BLUE : "rgba(145,184,215,0.22)",
                borderColor: index <= phaseState.index ? MEASURE_CYAN : "rgba(145,184,215,0.28)",
              }}
            />
            <div
              style={{
                ...styles.coachRailLabel,
                color: index === phaseState.index ? ICE : "rgba(222,241,255,0.46)",
              }}
            >
              {item.code}
            </div>
          </div>
        ))}
        <div style={{...styles.coachRailFill, width: `${((phaseState.index + progress) / COACH_PHASES.length) * 100}%`}} />
      </div>
    </>
  );
};

const CoachInsightRow: React.FC<{label: string; text: string}> = ({label, text}) => (
  <div style={styles.coachInsightRow}>
    <div style={styles.coachInsightLabel}>{label}</div>
    <div style={styles.coachInsightText}>{text}</div>
  </div>
);

const CoachValueCard: React.FC<{label: string; value: string; helper: string; active?: boolean}> = ({
  label,
  value,
  helper,
  active = false,
}) => (
  <div style={{...styles.coachValueCard, borderColor: active ? "rgba(94,231,255,0.58)" : "rgba(145,184,215,0.24)"}}>
    <div style={styles.coachValueLabel}>{label}</div>
    <div style={styles.coachValueNumber}>{value}</div>
    <div style={styles.coachValueHelper}>{helper}</div>
  </div>
);

const LegendDot: React.FC<{color: string; label: string}> = ({color, label}) => (
  <div style={styles.legendItem}>
    <span style={{...styles.legendDot, background: color, boxShadow: `0 0 16px ${color}`}} />
    <span>{label}</span>
  </div>
);

const StickerTelestrationOverlay: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phaseState: CoachPhaseState;
  camera: {position: THREE.Vector3; target: THREE.Vector3; fov: number};
  width: number;
  height: number;
}> = ({clip, shotFrame, contactFrame, phaseState, camera, width, height}) => {
  const frame = useCurrentFrame();
  const phase = COACH_PHASES[phaseState.index];
  const progress = coachPhaseProgress(phaseState.localFrame);
  const copy = stickerPhaseCopy(clip, phaseState.id);
  const geometry = stickerGeometry(clip, shotFrame, contactFrame, phaseState.id, camera, width, height);
  const draw = clamp01(interpolate(progress, [0.08, 0.72], [0, 1]));
  const pop = clamp01(interpolate(progress, [0.18, 0.46], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}));

  return (
    <>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={styles.stickerSvg}>
        <defs>
          <filter id="stickerGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrowCyan" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
            <path d="M1,1 L11,6 L1,11 Z" fill={MEASURE_CYAN} />
          </marker>
          <marker id="arrowViolet" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
            <path d="M1,1 L11,6 L1,11 Z" fill={FOOT_VIOLET} />
          </marker>
          <marker id="arrowBall" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
            <path d="M1,1 L11,6 L1,11 Z" fill={BALL_BLUE} />
          </marker>
        </defs>
        <TelestrationShapes geometry={geometry} phase={phaseState.id} draw={draw} />
      </svg>

      <div style={styles.stickerHeader}>
        <div style={styles.stickerKicker}>Shooting sticker cut</div>
        <div style={styles.stickerTitle}>{clip.shot.player || "Shooter"}</div>
        <div style={styles.stickerMeta}>{clip.matchFolder.replace(/_/g, " ")} · Event {clip.eventId}</div>
      </div>

      <div style={styles.stickerPhasePill}>
        <span style={styles.stickerPhaseCode}>{phase.code}</span>
        <span style={styles.stickerPhaseText}>{phase.label}</span>
      </div>

      <div style={styles.stickerStoryboard}>
        <div style={styles.stickerStoryKicker}>{copy.kicker}</div>
        <div style={styles.stickerStoryTitle}>{copy.title}</div>
        <div style={styles.stickerStoryText}>{copy.text}</div>
      </div>

      {copy.stickers.map((item, index) => (
        <StickerBubble
          key={`${item.label}-${index}`}
          label={item.label}
          value={item.value}
          color={item.color}
          x={item.x}
          y={item.y}
          delay={index * 5}
          localFrame={phaseState.localFrame}
          pop={pop}
        />
      ))}

      <div style={styles.stickerRail}>
        {COACH_PHASES.map((item, index) => (
          <div key={item.id} style={styles.stickerRailItem}>
            <div
              style={{
                ...styles.stickerRailDot,
                background: index === phaseState.index ? MEASURE_CYAN : index < phaseState.index ? SHOULDER_BLUE : "rgba(176,202,222,0.22)",
              }}
            />
            <div style={{...styles.stickerRailLabel, color: index === phaseState.index ? ICE : "rgba(225,241,255,0.48)"}}>
              {item.code}
            </div>
          </div>
        ))}
        <div style={{...styles.stickerRailFill, width: `${((phaseState.index + progress) / COACH_PHASES.length) * 100}%`}} />
      </div>

      <div style={{...styles.stickerTick, opacity: 0.42 + Math.sin(frame / 7) * 0.12}} />
    </>
  );
};

const TelestrationShapes: React.FC<{
  geometry: StickerGeometry;
  phase: CoachPhaseId;
  draw: number;
}> = ({geometry, phase, draw}) => {
  const line = (a?: ScreenPoint, b?: ScreenPoint, color = MEASURE_CYAN, width = 4, marker = "arrowCyan") => {
    if (!a || !b) return null;
    const shown = lerpPoint(a, b, draw);
    return (
      <line
        x1={a.x}
        y1={a.y}
        x2={shown.x}
        y2={shown.y}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        markerEnd={draw > 0.78 ? `url(#${marker})` : undefined}
        filter="url(#stickerGlow)"
      />
    );
  };
  const path = (points: ScreenPoint[], color: string, width = 4) => {
    const shown = points.slice(0, Math.max(2, Math.round(points.length * draw)));
    if (shown.length < 2) return null;
    return (
      <polyline
        points={shown.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#stickerGlow)"
      />
    );
  };
  const ring = (point?: ScreenPoint, radius = 48, color = MEASURE_CYAN) => {
    if (!point) return null;
    return (
      <circle
        cx={point.x}
        cy={point.y}
        r={radius * (0.62 + draw * 0.38)}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray="10 8"
        opacity={0.86}
        filter="url(#stickerGlow)"
      />
    );
  };

  return (
    <g>
      {phase === "context" ? ring(geometry.shooter, 42, SUBJECT_WHITE) : null}
      {phase === "context" ? line(geometry.ball, geometry.shotEnd, BALL_BLUE, 4, "arrowBall") : null}
      {phase === "context" ? ring(geometry.ball, 32, BALL_BLUE) : null}

      {phase === "approach" ? path(geometry.footPath, FOOT_VIOLET, 6) : null}
      {phase === "approach" ? line(geometry.ball, geometry.shotEnd, BALL_BLUE, 4, "arrowBall") : null}
      {phase === "approach" ? <SvgArc points={geometry.angleArc} color={MEASURE_CYAN} draw={draw} /> : null}
      {phase === "approach" ? ring(geometry.strikeFoot, 30, FOOT_VIOLET) : null}

      {phase === "backswing" ? line(geometry.leftHip, geometry.rightHip, HIP_GREEN, 6, "arrowCyan") : null}
      {phase === "backswing" ? line(geometry.leftShoulder, geometry.rightShoulder, SHOULDER_BLUE, 6, "arrowCyan") : null}
      {phase === "backswing" ? <SvgArc points={geometry.angleArc} color={MEASURE_CYAN} draw={draw} /> : null}
      {phase === "backswing" ? line(geometry.plantFoot, geometry.ball, MEASURE_CYAN, 5, "arrowCyan") : null}

      {phase === "contact" ? ring(geometry.ball, 58, MEASURE_CYAN) : null}
      {phase === "contact" ? line(geometry.strikeFoot, geometry.ball, MEASURE_CYAN, 6, "arrowCyan") : null}
      {phase === "contact" ? line(geometry.plantFoot, geometry.ball, PLANT_BLUE, 5, "arrowCyan") : null}
      {phase === "contact" ? line(geometry.strikeFootBack, geometry.strikeFoot, FOOT_VIOLET, 6, "arrowViolet") : null}
      {phase === "contact" ? line(geometry.ball, geometry.shotEnd, BALL_BLUE, 5, "arrowBall") : null}

      {phase === "follow" ? path(geometry.pelvisPath, MEASURE_CYAN, 5) : null}
      {phase === "follow" ? path(geometry.footPath, FOOT_VIOLET, 6) : null}
      {phase === "follow" ? ring(geometry.pelvis, 34, MEASURE_CYAN) : null}

      {phase === "output" ? path(geometry.ballPath, BALL_BLUE, 6) : null}
      {phase === "output" ? line(geometry.ball, geometry.shotEnd, BALL_BLUE, 5, "arrowBall") : null}
      {phase === "output" ? <SvgArc points={geometry.angleArc} color={MEASURE_CYAN} draw={draw} /> : null}
      {phase === "output" ? ring(geometry.ball, 34, BALL_BLUE) : null}
    </g>
  );
};

const SvgArc: React.FC<{points: ScreenPoint[]; color: string; draw: number}> = ({points, color, draw}) => {
  const shown = points.slice(0, Math.max(2, Math.round(points.length * draw)));
  if (shown.length < 2) return null;
  return (
    <polyline
      points={shown.map((point) => `${point.x},${point.y}`).join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#stickerGlow)"
    />
  );
};

const StickerBubble: React.FC<{
  label: string;
  value: string;
  color: string;
  x: number;
  y: number;
  delay: number;
  localFrame: number;
  pop: number;
  springEntrance?: boolean;
}> = ({label, value, color, x, y, delay, localFrame, pop, springEntrance}) => {
  const appear = interpolate(localFrame - delay, [0, 14], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const ent = springEntrance
    ? chipEntrance(appear)
    : {opacity: appear, translateY: 0, scale: 0.86 + appear * 0.14};
  const scale = ent.scale + Math.sin(pop * Math.PI) * 0.06;
  return (
    <div
      style={{
        ...styles.stickerBubble,
        left: x,
        top: y,
        opacity: ent.opacity,
        transform: `translate(-50%, calc(-50% + ${ent.translateY}px)) scale(${scale})`,
        borderColor: color,
        boxShadow: `0 0 24px ${transparentize(color, 0.45)}, 0 18px 46px rgba(0,0,0,0.42)`,
      }}
    >
      <div style={{...styles.stickerBubbleDot, background: color}} />
      <div>
        <div style={styles.stickerBubbleLabel}>{label}</div>
        <div style={styles.stickerBubbleValue}>{value}</div>
      </div>
    </div>
  );
};

const MechanicsWorld: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  contactFrame: ShotFrame;
  phase: PhaseId;
  localFrame: number;
}> = ({clip, shotFrame, contactFrame, phase, localFrame}) => {
  const frameForBody = phase === "contact" || phase === "backswing" ? contactFrame : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const contactShooter = shooterForFrame(clip, contactFrame);
  const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
  const contactBall = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball;
  const focus = contactBall || ball || new THREE.Vector3(0, 0, 0);
  const progress = phaseProgress(localFrame);

  return (
    <group>
      <CloseupFloor focus={focus} phase={phase} />
      <ReferenceGrid focus={focus} />
      {phase === "output" ? <GoalHint clip={clip} /> : null}
      {phase === "output" ? <BallFlightPath clip={clip} progress={progress} /> : null}
      {phase !== "output" ? <FootTrail clip={clip} currentFrame={shotFrame.frameNumber} progress={phase === "approach" ? progress : 1} /> : null}
      {phase === "follow" ? <PelvisContinuation clip={clip} currentFrame={shotFrame.frameNumber} progress={progress} /> : null}
      {phase === "follow" ? <FollowFootPath clip={clip} currentFrame={shotFrame.frameNumber} progress={progress} /> : null}
      {contactShooter && phase !== "approach" ? <ContactGhost player={contactShooter} /> : null}
      {shooter ? <PlayerSkeleton clip={clip} player={shooter} phase={phase} /> : null}
      {ball ? <BallMesh position={ball} phase={phase} /> : null}
      {contactBall && phase !== "output" ? <ContactPulse position={contactBall} progress={progress} /> : null}
      {phase === "approach" && shooter && contactBall ? <ApproachGraphics clip={clip} player={shooter} ball={contactBall} progress={progress} /> : null}
      {phase === "backswing" && contactShooter ? <BackswingGraphics clip={clip} player={contactShooter} progress={progress} /> : null}
      {phase === "contact" && contactShooter && contactBall ? (
        <ContactMeasurements clip={clip} player={contactShooter} ball={contactBall} progress={progress} />
      ) : null}
      {phase === "output" && ball && shotFrame.ball?.velocity ? <ExitVelocityArrow ball={ball} velocity={shotFrame.ball.velocity} progress={progress} /> : null}
    </group>
  );
};

const VariantOverlay: React.FC<{clip: Clip; phaseState: PhaseState; variant: PresentationVariant}> = ({
  clip,
  phaseState,
  variant,
}) => {
  if (variant === "split") return <SplitCoachingOverlay clip={clip} phaseState={phaseState} />;
  if (variant === "broadcast") return <BroadcastOverlay clip={clip} phaseState={phaseState} />;
  if (variant === "diagnostic") return <DiagnosticOverlay clip={clip} phaseState={phaseState} />;
  return <PhaseOverlay clip={clip} phaseState={phaseState} />;
};

const PhaseOverlay: React.FC<{
  clip: Clip;
  phaseState: PhaseState;
}> = ({clip, phaseState}) => {
  const phase = PHASES[phaseState.index];
  const progress = phaseProgress(phaseState.localFrame);
  const footSpeed = numberValue(clip.features.foot_velocity_into_ball_m_s) || numberValue(clip.features.foot_speed_m_s);
  const exitSpeed = numberValue(clip.features.ball_exit_speed_m_s);
  const launchAngle = numberValue(clip.features.launch_angle_deg);
  const separation = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  const footGap = numberValue(clip.features.min_foot_ball_distance_m);
  const plantOffset = numberValue(clip.features.plant_foot_lateral_offset_m);
  const pScore = phaseScore(clip, phaseState.id);
  const detail = overlayDetail(clip, phaseState.id);

  return (
    <>
      <div style={styles.phaseHeader}>
        <div style={styles.kicker}>Phase mechanics closeup</div>
        <div style={styles.title}>{clip.shot.player || "Standout shot"}</div>
        <div style={styles.meta}>{clip.matchFolder.replace(/_/g, " ")} · {clip.shot.team || "Team"} · Event {clip.eventId}</div>
      </div>

      <div style={styles.phaseChip}>
        <span style={styles.phaseCode}>{phase.label}</span>
        <span style={styles.phaseShort}>{phase.short}</span>
      </div>

      <div style={styles.chapterRail}>
        {PHASES.map((item, index) => (
          <div key={item.id} style={styles.chapterItem}>
            <div
              style={{
                ...styles.chapterDot,
                borderColor: index <= phaseState.index ? ELECTRIC : "rgba(207,238,255,0.24)",
                background: index === phaseState.index ? ELECTRIC : "rgba(11,28,54,0.82)",
                boxShadow: index === phaseState.index ? "0 0 22px rgba(30,231,255,0.72)" : "none",
              }}
            />
            <div style={{...styles.chapterLabel, color: index === phaseState.index ? ICE : "rgba(207,238,255,0.38)"}}>
              {item.label.replace(" ", "\n")}
            </div>
          </div>
        ))}
        <div style={{...styles.chapterFill, width: `${((phaseState.index + progress) / PHASES.length) * 100}%`}} />
      </div>

      <div style={styles.readoutPanel}>
        <div style={styles.readoutEyebrow}>{phase.headline}</div>
        <div style={styles.readoutText}>{phase.implication}</div>
        <div style={styles.readoutMetric}>{detail}</div>
      </div>

      <div style={styles.metricStack}>
        <MetricCell label="Phase score" value={formatScore(pScore)} />
        {phaseState.id === "approach" ? <MetricCell label="Foot into ball" value={formatVelocity(footSpeed)} /> : null}
        {phaseState.id === "backswing" ? <MetricCell label="Separation" value={formatDegrees(separation)} /> : null}
        {phaseState.id === "contact" ? <MetricCell label="Foot-ball" value={formatDistance(footGap)} /> : null}
        {phaseState.id === "contact" ? <MetricCell label="Plant offset" value={formatSignedDistance(plantOffset)} /> : null}
        {phaseState.id === "follow" ? <MetricCell label="Follow score" value={formatScore(numberValue(clip.score.P5_score))} /> : null}
        {phaseState.id === "output" ? <MetricCell label="Exit speed" value={formatVelocity(exitSpeed)} /> : null}
        {phaseState.id === "output" ? <MetricCell label="Launch" value={formatDegrees(launchAngle)} /> : null}
      </div>
    </>
  );
};

const SplitCoachingOverlay: React.FC<{clip: Clip; phaseState: PhaseState}> = ({clip, phaseState}) => {
  const phase = PHASES[phaseState.index];
  const detail = phaseBiomechanics(clip, phaseState.id);
  const progress = phaseProgress(phaseState.localFrame);
  return (
    <>
      <div style={styles.splitShade} />
      <div style={styles.splitTitle}>
        <div style={styles.kicker}>Phase mechanics coach view</div>
        <div style={styles.title}>{phase.label}: {phase.short}</div>
        <div style={styles.meta}>{clip.shot.player || "Shooter"} · {clip.matchFolder.replace(/_/g, " ")}</div>
      </div>
      <div style={styles.splitPanel}>
        <div style={styles.splitPanelKicker}>Measured Feature</div>
        <div style={styles.splitPanelTitle}>{detail.measured}</div>
        <div style={styles.splitPanelMetric}>{detail.value}</div>
        <div style={styles.splitPanelSection}>Optimizes</div>
        <div style={styles.splitPanelText}>{detail.optimizes}</div>
        <div style={styles.splitPanelSection}>Biomechanical implication</div>
        <div style={styles.splitPanelText}>{detail.implication}</div>
        <div style={styles.splitPanelSection}>Risk if missing</div>
        <div style={styles.splitPanelText}>{detail.risk}</div>
      </div>
      <MiniPhaseRail phaseState={phaseState} progress={progress} compact />
    </>
  );
};

const BroadcastOverlay: React.FC<{clip: Clip; phaseState: PhaseState}> = ({clip, phaseState}) => {
  const phase = PHASES[phaseState.index];
  const detail = phaseBiomechanics(clip, phaseState.id);
  const progress = phaseProgress(phaseState.localFrame);
  return (
    <>
      <div style={styles.broadcastTopline}>
        <span style={styles.broadcastLeague}>Shooting mechanics</span>
        <span style={styles.broadcastDot} />
        <span>{clip.shot.player || "Shooter"}</span>
      </div>
      <div style={styles.broadcastHero}>
        <div style={styles.broadcastPhase}>{phase.label}</div>
        <div style={styles.broadcastHeadline}>{detail.broadcast}</div>
        <div style={styles.broadcastSub}>{detail.value} · {detail.optimizes}</div>
      </div>
      <div style={styles.broadcastMeasure}>
        <div style={styles.broadcastMeasureLabel}>{detail.measured}</div>
        <div style={styles.broadcastMeasureValue}>{detail.value}</div>
      </div>
      <MiniPhaseRail phaseState={phaseState} progress={progress} broadcast />
    </>
  );
};

const DiagnosticOverlay: React.FC<{clip: Clip; phaseState: PhaseState}> = ({clip, phaseState}) => {
  const phase = PHASES[phaseState.index];
  const detail = phaseBiomechanics(clip, phaseState.id);
  const comparison = data.clips[1];
  const score = phaseScore(clip, phaseState.id);
  const compareScore = comparison ? phaseScore(comparison, phaseState.id) : Number.NaN;
  const qValue = numberValue(clip.score[`${phaseCode(phaseState.id)}_q`]);
  return (
    <>
      <div style={styles.diagnosticHeader}>
        <div style={styles.kicker}>Metric diagnostic lab</div>
        <div style={styles.title}>{phase.label}</div>
        <div style={styles.meta}>Feature registry view · frame role: {frameRoleForPhase(phaseState.id)}</div>
      </div>
      <div style={styles.diagnosticPanel}>
        <div style={styles.diagnosticPhaseGrid}>
          {PHASES.map((item, index) => (
            <div
              key={item.id}
              style={{
                ...styles.diagnosticPhaseCell,
                borderColor: index === phaseState.index ? ELECTRIC : "rgba(125,190,255,0.18)",
                background: index === phaseState.index ? "rgba(30,231,255,0.16)" : "rgba(5,18,38,0.58)",
              }}
            >
              <div style={styles.diagnosticPhaseCode}>{item.label.slice(0, 2)}</div>
              <div style={styles.diagnosticPhaseScore}>{formatScore(phaseScore(clip, item.id))}</div>
            </div>
          ))}
        </div>
        <div style={styles.diagnosticMeasured}>{detail.measured}</div>
        <div style={styles.diagnosticValue}>{detail.value}</div>
        <MetricBar label="This shot" value={score} color={ELECTRIC} />
        {comparison ? <MetricBar label="Constraint sample" value={compareScore} color={VIOLET} /> : null}
        <div style={styles.diagnosticText}><strong>Optimization:</strong> {detail.optimizes}</div>
        <div style={styles.diagnosticText}><strong>Implication:</strong> {detail.implication}</div>
        <div style={styles.diagnosticText}><strong>Confidence:</strong> {Number.isNaN(qValue) ? "phase-derived" : `${Math.round(qValue * 100)}%`}</div>
      </div>
    </>
  );
};

const MiniPhaseRail: React.FC<{phaseState: PhaseState; progress: number; compact?: boolean; broadcast?: boolean}> = ({
  phaseState,
  progress,
  compact = false,
  broadcast = false,
}) => (
  <div style={broadcast ? styles.broadcastRail : compact ? styles.splitRail : styles.chapterRail}>
    {PHASES.map((item, index) => (
      <div key={item.id} style={broadcast ? styles.broadcastRailItem : compact ? styles.splitRailItem : styles.chapterItem}>
        <div
          style={{
            ...(broadcast ? styles.broadcastRailDot : compact ? styles.splitRailDot : styles.chapterDot),
            background: index === phaseState.index ? ELECTRIC : index < phaseState.index ? PLANT_BLUE : "rgba(11,28,54,0.82)",
            borderColor: index <= phaseState.index ? ELECTRIC : "rgba(207,238,255,0.24)",
          }}
        />
        <div style={broadcast ? styles.broadcastRailLabel : compact ? styles.splitRailLabel : styles.chapterLabel}>
          {item.label.slice(0, 2)}
        </div>
      </div>
    ))}
    <div
      style={{
        ...(broadcast ? styles.broadcastRailFill : compact ? styles.splitRailFill : styles.chapterFill),
        width: `${((phaseState.index + progress) / PHASES.length) * 100}%`,
      }}
    />
  </div>
);

const MetricBar: React.FC<{label: string; value: number; color: string}> = ({label, value, color}) => (
  <div style={styles.metricBarRow}>
    <div style={styles.metricBarLabel}>{label}</div>
    <div style={styles.metricBarTrack}>
      <div style={{...styles.metricBarFill, width: `${clamp01((Number.isNaN(value) ? 0 : value) / 100) * 100}%`, background: color}} />
    </div>
    <div style={styles.metricBarValue}>{formatScore(value)}</div>
  </div>
);

const phaseBiomechanics = (clip: Clip, phase: PhaseId) => {
  const approachSpeed = numberValue(clip.features.approach_speed_m_s);
  const approachAngle = numberValue(clip.features.approach_angle_deg);
  const separation = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  const footGap = numberValue(clip.features.min_foot_ball_distance_m);
  const plantForward = numberValue(clip.features.plant_foot_forward_offset_m);
  const plantLateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  const footVelocity = numberValue(clip.features.foot_velocity_into_ball_m_s);
  const ballRatio = numberValue(clip.features.ball_to_foot_speed_ratio);
  const follow = numberValue(clip.score.P5_score);
  const exit = numberValue(clip.features.ball_exit_speed_m_s);
  const launch = numberValue(clip.features.launch_angle_deg);
  const placement = numberValue(clip.score.placement_score);

  if (phase === "approach") {
    return {
      measured: "Approach speed and path into the ball",
      value: `${formatVelocity(approachSpeed)} · ${formatDegrees(approachAngle)} approach angle`,
      optimizes: "A controlled runway so the swing foot accelerates late instead of reaching early.",
      implication: "The foot trail should arrive through the ball while the trunk stays organized for the plant step.",
      risk: "A rushed or side-on approach makes the next phases compensate for timing.",
      broadcast: "Run-up creates the runway for the strike.",
    };
  }
  if (phase === "backswing") {
    return {
      measured: "Hip-shoulder separation angle",
      value: formatDegrees(separation),
      optimizes: "Rotational storage: hips can lead while shoulders delay, then unwind into contact.",
      implication: "The animated axes show whether the body has useful coil rather than a flat swing.",
      risk: "Too little coil loses power; uncontrolled coil pulls the strike off line.",
      broadcast: "Rotation loads before the foot releases.",
    };
  }
  if (phase === "contact") {
    return {
      measured: "Foot-ball gap, plant base, and foot velocity",
      value: `${formatDistance(footGap)} gap · ${formatSignedDistance(plantLateral)} lateral · ${formatSignedDistance(plantForward)} forward · ${formatVelocity(footVelocity)}`,
      optimizes: "Compact contact with a braced plant so swing speed becomes ball speed.",
      implication: "The two brackets show the actual geometry: strike-foot spacing and the plant post around the ball.",
      risk: `A loose contact gap or unstable plant leaks transfer; ball-to-foot ratio ${formatRatio(ballRatio)} helps audit conversion.`,
      broadcast: "Impact turns body mechanics into ball speed.",
    };
  }
  if (phase === "follow") {
    return {
      measured: "Follow-through continuity",
      value: `P5 ${formatScore(follow)} · COM continuation ${formatScore(numberValue(clip.features.com_continuation_score) * 100)}`,
      optimizes: "Momentum continues through the ball instead of stopping at the strike frame.",
      implication: "The pelvis and foot trails show whether the body carries the shot after impact.",
      risk: "A stalled follow-through can still hit the ball hard, but it is harder to repeat and place.",
      broadcast: "The body keeps carrying through contact.",
    };
  }
  return {
    measured: "Exit speed, launch, and placement",
    value: `${formatVelocity(exit)} exit · ${formatDegrees(launch)} launch · placement ${formatScore(placement)}`,
    optimizes: "The final ball path checks whether mechanics became useful shot output.",
    implication: "The trajectory reveals transfer, launch control, and whether the strike stayed on its intended line.",
    risk: "Strong mechanics can still leave a weaker outcome if the release angle or placement is off.",
    broadcast: "The ball flight is the audit trail.",
  };
};

const phaseCode = (phase: PhaseId) => {
  if (phase === "approach") return "P2";
  if (phase === "backswing") return "P3";
  if (phase === "contact") return "P4";
  if (phase === "follow") return "P5";
  return "P6";
};

const frameRoleForPhase = (phase: PhaseId) => {
  if (phase === "approach") return "P2 approach window";
  if (phase === "backswing") return "P3 loading / biomech";
  if (phase === "contact") return "P4 visual contact";
  if (phase === "follow") return "P5 follow-through";
  return "P6 physics exit";
};

const MetricCell: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div style={styles.metricCell}>
    <div style={styles.metricLabel}>{label}</div>
    <div style={styles.metricValue}>{value}</div>
  </div>
);

const ContextPlayers: React.FC<{clip: Clip; frame: ShotFrame; progress: number}> = ({clip, frame, progress}) => {
  const shooter = shooterForFrame(clip, frame);
  const shooterTeam = shooter?.teamCode;
  return (
    <group>
      {(frame.players || []).map((player, index) => {
        const isShooter = player.name === clip.shot.player;
        const isOpponent = shooterTeam !== undefined && player.teamCode !== undefined && player.teamCode !== shooterTeam;
        if (isShooter) {
          return <CoachPlayerSkeleton key={`ctx-${player.name || index}`} clip={clip} player={player} phase="approach" />;
        }
        return (
          <SimplePlayerSkeleton
            key={`ctx-${player.name || index}`}
            player={player}
            color={isOpponent ? OPPONENT_STEEL : "#75d2ff"}
            opacity={(isOpponent ? 0.36 : 0.22) * (0.7 + progress * 0.3)}
            radius={isOpponent ? 0.026 : 0.021}
          />
        );
      })}
    </group>
  );
};

const GroundedContextGraphics: React.FC<{
  clip: Clip;
  ball: THREE.Vector3;
  progress: number;
  showRangeArcs?: boolean;
  emphasizePressure?: boolean;
}> = ({clip, ball, progress, showRangeArcs, emphasizePressure}) => {
  const direction = shotDirectionVector(clip);
  const start = groundPoint(ball).sub(direction.clone().multiplyScalar(0.35));
  const end = groundPoint(ball).add(direction.clone().multiplyScalar(showRangeArcs ? 12 : 8.6));
  const side = new THREE.Vector3(-direction.z, 0, direction.x);
  const draw = clamp01(interpolate(progress, [0.16, 0.72], [0, 1]));
  const laneOpacity = emphasizePressure ? 0.38 : 0.2;

  return (
    <group>
      <GroundRibbonArrow start={start} end={end} color={BALL_BLUE} progress={draw} width={0.16} opacity={0.72} />
      {[-0.9, 0.9].map((offset) => (
        <GroundRibbonSegment
          key={`ground-context-lane-${offset}`}
          start={start.clone().add(side.clone().multiplyScalar(offset))}
          end={end.clone().add(side.clone().multiplyScalar(offset))}
          color={emphasizePressure ? "#ff8a8a" : OPPONENT_STEEL}
          width={emphasizePressure ? 0.05 : 0.035}
          opacity={laneOpacity}
        />
      ))}
      {showRangeArcs
        ? [1.2, 2.4, 3.6].map((r) => (
            <GroundRing key={`ctx-range-${r}`} point={groundPoint(ball, 0.045)} color={MEASURE_CYAN} radius={r} opacity={0.42 * draw} />
          ))
        : null}
      <GroundRing point={groundPoint(ball, 0.045)} color={BALL_BLUE} radius={0.7} opacity={0.68} />
    </group>
  );
};

const GroundedApproachGraphics: React.FC<{
  clip: Clip;
  player: Player;
  ball: THREE.Vector3;
  progress: number;
  showTrunkLean?: boolean;
}> = ({clip, player, ball, progress, showTrunkLean}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  if (!strikeFoot) return null;
  const contact = contactNumber(clip);
  const part = `${String(clip.features.inferred_foot || "right")}_toe`;
  const approachDir = footTrajectoryDirection(clip, contact - 34, contact, part);
  const shotDir = shotDirectionVector(clip);
  const strikeGround = groundPoint(strikeFoot);
  const runwayStart = strikeGround.clone().sub(approachDir.clone().multiplyScalar(2.35));
  const runwayEnd = strikeGround.clone().add(approachDir.clone().multiplyScalar(0.2));
  const shotStart = groundPoint(ball).sub(shotDir.clone().multiplyScalar(0.15));
  const shotEnd = shotStart.clone().add(shotDir.clone().multiplyScalar(3.2));
  const drawRunway = clamp01(interpolate(progress, [0.05, 0.46], [0, 1]));
  const drawShot = clamp01(interpolate(progress, [0.22, 0.62], [0, 1]));
  const drawAngle = clamp01(interpolate(progress, [0.48, 0.9], [0, 1]));
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  const neck = player.parts.neck ? toThree(player.parts.neck) : null;

  return (
    <group>
      <GroundTrail clip={clip} startFrame={contact - 38} endFrame={contact} part={part} progress={drawRunway} color={FOOT_VIOLET} />
      <GroundRibbonArrow start={runwayStart} end={runwayEnd} color={FOOT_VIOLET} progress={drawRunway} width={0.18} opacity={0.78} />
      <GroundRibbonArrow start={shotStart} end={shotEnd} color={BALL_BLUE} progress={drawShot} width={0.13} opacity={0.68} />
      {showTrunkLean && pelvis && neck ? (
        <AnimatedArrow
          start={pelvis.clone().add(new THREE.Vector3(0, 0.12, 0))}
          end={neck.clone().add(new THREE.Vector3(0.08, 0, -0.05))}
          color={MEASURE_CYAN}
          progress={drawAngle}
          radius={0.028}
        />
      ) : null}
      <GroundAngleGauge
        center={groundPoint(ball, 0.055)}
        fromAngle={Math.atan2(approachDir.z, approachDir.x)}
        toAngle={Math.atan2(shotDir.z, shotDir.x)}
        radius={showTrunkLean ? 0.48 : 0.58}
        color={MEASURE_CYAN}
        progress={drawAngle}
      />
    </group>
  );
};

const GroundedBackswingGraphics: React.FC<{clip: Clip; player: Player; progress: number}> = ({
  clip,
  player,
  progress,
}) => {
  const leftShoulder = player.parts.left_shoulder ? toThree(player.parts.left_shoulder) : null;
  const rightShoulder = player.parts.right_shoulder ? toThree(player.parts.right_shoulder) : null;
  const leftHip = player.parts.left_hip ? toThree(player.parts.left_hip) : null;
  const rightHip = player.parts.right_hip ? toThree(player.parts.right_hip) : null;
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  const plantFoot = plantFootPoint(clip, player);
  const ball = nearestFrame(clip, contactNumber(clip)).ball?.position ? toThree(nearestFrame(clip, contactNumber(clip)).ball!.position!) : null;
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !pelvis) return null;

  const axisProgress = clamp01(interpolate(progress, [0.08, 0.48], [0, 1]));
  const angleProgress = clamp01(interpolate(progress, [0.36, 0.88], [0, 1]));
  const hipAngle = axisAngle(leftHip, rightHip);
  const shoulderAngle = axisAngle(leftShoulder, rightShoulder);
  const hipMid = leftHip.clone().lerp(rightHip, 0.5);
  const shoulderMid = leftShoulder.clone().lerp(rightShoulder, 0.5);

  return (
    <group>
      <AnimatedCylinder start={leftHip} end={rightHip} color={HIP_GREEN} progress={axisProgress} radius={0.056} />
      <AnimatedCylinder start={leftShoulder} end={rightShoulder} color={SHOULDER_BLUE} progress={axisProgress} radius={0.05} />
      <ExtendedAxisBar center={hipMid} angle={hipAngle} color={HIP_GREEN} progress={axisProgress} length={1.35} />
      <ExtendedAxisBar center={shoulderMid} angle={shoulderAngle} color={SHOULDER_BLUE} progress={axisProgress} length={1.35} />
      <BodyAngleGauge
        center={pelvis.clone().add(new THREE.Vector3(0, 0.72, 0))}
        fromAngle={hipAngle}
        toAngle={shoulderAngle}
        radius={0.82}
        color={MEASURE_CYAN}
        progress={angleProgress}
      />
      <AxisEndpointSpheres points={[leftHip, rightHip]} color={HIP_GREEN} progress={axisProgress} />
      <AxisEndpointSpheres points={[leftShoulder, rightShoulder]} color={SHOULDER_BLUE} progress={axisProgress} />
      {plantFoot && ball ? (
        <GroundDistanceRuler
          start={groundPoint(plantFoot)}
          end={groundPoint(ball)}
          color={PLANT_BLUE}
          progress={clamp01(interpolate(progress, [0.5, 0.94], [0, 1]))}
        />
      ) : null}
    </group>
  );
};

const GroundedContactGraphics: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({
  clip,
  player,
  ball,
  progress,
}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  const plantFoot = plantFootPoint(clip, player);
  const contact = contactNumber(clip);
  const part = `${String(clip.features.inferred_foot || "right")}_toe`;
  const footDir = footTrajectoryDirection(clip, contact - 5, contact, part);
  const shotDir = shotDirectionVector(clip);
  const gapDraw = clamp01(interpolate(progress, [0.06, 0.42], [0, 1]));
  const plantDraw = clamp01(interpolate(progress, [0.24, 0.58], [0, 1]));
  const velocityDraw = clamp01(interpolate(progress, [0.46, 0.88], [0, 1]));

  return (
    <group>
      {strikeFoot ? (
        <GroundDistanceRuler
          start={groundPoint(strikeFoot, 0.062)}
          end={groundPoint(ball, 0.062)}
          color={MEASURE_CYAN}
          progress={gapDraw}
          compact
        />
      ) : null}
      {plantFoot ? (
        <GroundDistanceRuler
          start={groundPoint(plantFoot)}
          end={groundPoint(ball)}
          color={PLANT_BLUE}
          progress={plantDraw}
        />
      ) : null}
      {strikeFoot ? (
        <GroundRibbonArrow
          start={groundPoint(strikeFoot).sub(footDir.clone().multiplyScalar(1.15))}
          end={groundPoint(strikeFoot).add(footDir.clone().multiplyScalar(0.55))}
          color={FOOT_VIOLET}
          progress={velocityDraw}
          width={0.16}
          opacity={0.76}
        />
      ) : null}
      <GroundRibbonArrow
        start={groundPoint(ball).sub(shotDir.clone().multiplyScalar(0.08))}
        end={groundPoint(ball).add(shotDir.clone().multiplyScalar(2.4))}
        color={BALL_BLUE}
        progress={velocityDraw}
        width={0.15}
        opacity={0.75}
      />
      <GroundRing point={groundPoint(ball, 0.045)} color={MEASURE_CYAN} radius={0.48} opacity={0.94} />
    </group>
  );
};

const GroundedFollowGraphics: React.FC<{
  clip: Clip;
  currentFrame: number;
  progress: number;
  emphasizeContinuation?: boolean;
}> = ({clip, currentFrame, progress, emphasizeContinuation}) => {
  const contact = contactNumber(clip);
  const strikePart = `${String(clip.features.inferred_foot || "right")}_toe`;
  const drawFoot = clamp01(interpolate(progress, [0.06, 0.64], [0, 1]));
  const drawPelvis = clamp01(interpolate(progress, [0.24, 0.88], [0, 1]));
  const pelvisColor = emphasizeContinuation ? "#ff8a8a" : MEASURE_CYAN;
  const pelvisWidth = emphasizeContinuation ? 0.09 : 0.05;
  return (
    <group>
      <GroundTrail clip={clip} startFrame={contact} endFrame={Math.min(currentFrame, contact + 34)} part={strikePart} progress={drawFoot} color={FOOT_VIOLET} />
      <GroundTrail
        clip={clip}
        startFrame={contact}
        endFrame={Math.min(currentFrame, contact + 34)}
        part="pelvis"
        progress={drawPelvis}
        color={pelvisColor}
        width={pelvisWidth}
      />
    </group>
  );
};

const GroundedOutputGraphics: React.FC<{
  clip: Clip;
  ball: THREE.Vector3;
  velocity: Vec3;
  progress: number;
  heroTrajectory?: boolean;
}> = ({clip, ball, velocity, progress, heroTrajectory}) => {
  const shotDir = shotDirectionVector(clip);
  const contact = contactNumber(clip);
  const drawPath = clamp01(interpolate(progress, [0.04, 0.72], [0, 1]));
  const drawLaunch = clamp01(interpolate(progress, [0.34, 0.88], [0, 1]));
  return (
    <group>
      <GroundBallPathShadow clip={clip} startFrame={contact} progress={drawPath} />
      <BallFlightPath clip={clip} progress={drawPath} />
      <GroundRibbonArrow
        start={groundPoint(ball).sub(shotDir.clone().multiplyScalar(0.08))}
        end={groundPoint(ball).add(shotDir.clone().multiplyScalar(heroTrajectory ? 3.4 : 2.65))}
        color={BALL_BLUE}
        progress={clamp01(interpolate(progress, [0.08, 0.5], [0, 1]))}
        width={heroTrajectory ? 0.18 : 0.14}
        opacity={heroTrajectory ? 0.88 : 0.7}
      />
      <LaunchAngleArc ball={ball} velocity={velocity} progress={drawLaunch} />
      <GroundRing point={groundPoint(ball, 0.045)} color={BALL_BLUE} radius={heroTrajectory ? 0.72 : 0.58} opacity={0.78} />
    </group>
  );
};

const CoachApproachGraphics: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({
  clip,
  player,
  ball,
  progress,
}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  const shotDir = shotDirectionVector(clip);
  if (!strikeFoot) return null;
  const approachDir = footTrajectoryDirection(clip, contactNumber(clip) - 34, contactNumber(clip), `${String(clip.features.inferred_foot || "right")}_toe`);
  const shotStart = ball.clone().add(new THREE.Vector3(0, 0.16, 0));
  const shotEnd = shotStart.clone().add(shotDir.multiplyScalar(2.4));
  const runwayStart = strikeFoot.clone().sub(approachDir.clone().multiplyScalar(2.2)).add(new THREE.Vector3(0, 0.18, 0));
  const runwayEnd = strikeFoot.clone().add(new THREE.Vector3(0, 0.18, 0));

  return (
    <group>
      <AnimatedArrow start={runwayStart} end={runwayEnd} color={FOOT_VIOLET} progress={clamp01(interpolate(progress, [0.04, 0.46], [0, 1]))} radius={0.035} />
      <AnimatedArrow start={shotStart} end={shotEnd} color={BALL_BLUE} progress={clamp01(interpolate(progress, [0.2, 0.64], [0, 1]))} radius={0.026} />
      <PlanarAngleArc
        center={ball.clone().add(new THREE.Vector3(0, 0.22, 0))}
        fromAngle={Math.atan2(approachDir.z, approachDir.x)}
        toAngle={Math.atan2(shotDir.z, shotDir.x)}
        radius={0.72}
        color={MEASURE_CYAN}
        progress={clamp01(interpolate(progress, [0.48, 0.9], [0, 1]))}
      />
      <GlowSphere point={strikeFoot} color={FOOT_VIOLET} radius={0.16} opacity={0.64} />
      <GroundRing point={new THREE.Vector3(ball.x, 0.04, ball.z)} color={BALL_BLUE} radius={0.52} opacity={0.82} />
    </group>
  );
};

const CoachBackswingGraphics: React.FC<{clip: Clip; player: Player; progress: number}> = ({clip, player, progress}) => {
  const leftShoulder = player.parts.left_shoulder ? toThree(player.parts.left_shoulder) : null;
  const rightShoulder = player.parts.right_shoulder ? toThree(player.parts.right_shoulder) : null;
  const leftHip = player.parts.left_hip ? toThree(player.parts.left_hip) : null;
  const rightHip = player.parts.right_hip ? toThree(player.parts.right_hip) : null;
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  const plantFoot = plantFootPoint(clip, player);
  const ball = nearestFrame(clip, contactNumber(clip)).ball?.position ? toThree(nearestFrame(clip, contactNumber(clip)).ball!.position!) : null;
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !pelvis) return null;
  const axisProgress = clamp01(interpolate(progress, [0.08, 0.48], [0, 1]));
  const arcProgress = clamp01(interpolate(progress, [0.4, 0.84], [0, 1]));

  return (
    <group>
      <AnimatedCylinder start={leftHip} end={rightHip} color={HIP_GREEN} progress={axisProgress} radius={0.052} />
      <AnimatedCylinder start={leftShoulder} end={rightShoulder} color={SHOULDER_BLUE} progress={axisProgress} radius={0.047} />
      <AngleArc
        center={pelvis.clone().add(new THREE.Vector3(0, 0.82, 0))}
        shoulderA={leftShoulder}
        shoulderB={rightShoulder}
        hipA={leftHip}
        hipB={rightHip}
        progress={arcProgress}
        shownDegrees={numberValue(clip.features.peak_shoulder_hip_separation_deg)}
      />
      {plantFoot && ball ? (
        <GroundRuler
          start={new THREE.Vector3(plantFoot.x, 0.08, plantFoot.z)}
          end={new THREE.Vector3(ball.x, 0.08, ball.z)}
          color={MEASURE_CYAN}
          progress={clamp01(interpolate(progress, [0.52, 0.96], [0, 1]))}
        />
      ) : null}
    </group>
  );
};

const CoachContactTransferGraphics: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({
  clip,
  player,
  ball,
  progress,
}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  const plantFoot = plantFootPoint(clip, player);
  const contact = contactNumber(clip);
  const footDir = footTrajectoryDirection(clip, contact - 4, contact, `${String(clip.features.inferred_foot || "right")}_toe`);
  const ballDir = shotDirectionVector(clip);
  const lineProgress = clamp01(interpolate(progress, [0.06, 0.38], [0, 1]));
  const rulerProgress = clamp01(interpolate(progress, [0.22, 0.56], [0, 1]));
  const velocityProgress = clamp01(interpolate(progress, [0.48, 0.88], [0, 1]));

  return (
    <group>
      {strikeFoot ? <DistanceMeasure start={strikeFoot} end={ball} color={MEASURE_CYAN} progress={lineProgress} radius={0.04} ticks /> : null}
      {plantFoot ? (
        <GroundRuler
          start={new THREE.Vector3(plantFoot.x, 0.08, plantFoot.z)}
          end={new THREE.Vector3(ball.x, 0.08, ball.z)}
          color={PLANT_BLUE}
          progress={rulerProgress}
        />
      ) : null}
      {strikeFoot ? (
        <AnimatedArrow
          start={strikeFoot.clone().add(new THREE.Vector3(0, 0.18, 0))}
          end={strikeFoot.clone().add(new THREE.Vector3(0, 0.18, 0)).add(footDir.multiplyScalar(1.55))}
          color={FOOT_VIOLET}
          progress={velocityProgress}
          radius={0.035}
        />
      ) : null}
      <AnimatedArrow
        start={ball.clone().add(new THREE.Vector3(0, 0.16, 0))}
        end={ball.clone().add(new THREE.Vector3(0, 0.16, 0)).add(ballDir.multiplyScalar(2.25))}
        color={BALL_BLUE}
        progress={velocityProgress}
        radius={0.034}
      />
      <GroundRing point={new THREE.Vector3(ball.x, 0.04, ball.z)} color={MEASURE_CYAN} radius={0.46} opacity={0.94} />
    </group>
  );
};

const CoachOutputGraphics: React.FC<{clip: Clip; ball: THREE.Vector3; velocity: Vec3; progress: number}> = ({
  clip,
  ball,
  velocity,
  progress,
}) => (
  <group>
    <BallFlightPath clip={clip} progress={progress} />
    <ExitVelocityArrow ball={ball} velocity={velocity} progress={clamp01(interpolate(progress, [0.04, 0.44], [0, 1]))} />
    <LaunchAngleArc ball={ball} velocity={velocity} progress={clamp01(interpolate(progress, [0.34, 0.86], [0, 1]))} />
  </group>
);

const CoachShotLane: React.FC<{clip: Clip; ball: THREE.Vector3; progress: number}> = ({clip, ball, progress}) => {
  const direction = shotDirectionVector(clip);
  const start = ball.clone().add(new THREE.Vector3(0, 0.1, 0));
  const end = start.clone().add(direction.clone().multiplyScalar(8));
  const side = new THREE.Vector3(-direction.z, 0, direction.x);
  return (
    <group>
      <AnimatedArrow start={start} end={end} color={BALL_BLUE} progress={clamp01(interpolate(progress, [0.18, 0.72], [0, 1]))} radius={0.025} />
      {[-1.1, 1.1].map((offset) => (
        <LineMesh
          key={`context-lane-${offset}`}
          points={[start.clone().add(side.clone().multiplyScalar(offset)), end.clone().add(side.clone().multiplyScalar(offset))]}
          color={OPPONENT_STEEL}
          opacity={0.16}
        />
      ))}
      <GroundRing point={new THREE.Vector3(ball.x, 0.04, ball.z)} color={BALL_BLUE} radius={0.68} opacity={0.76} />
    </group>
  );
};

const CoachFloor: React.FC<{focus: THREE.Vector3; wide: boolean; turf?: "default" | "grounded"}> = ({
  focus,
  wide,
  turf = "default",
}) => {
  const radius = wide ? 15 : 5.8;
  const turfColor = turf === "grounded" ? "#1a3328" : "#06162d";
  return (
    <group>
      <mesh position={[focus.x, -0.058, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 128]} />
        <meshStandardMaterial color={turfColor} roughness={0.86} metalness={0.04} />
      </mesh>
      <mesh position={[focus.x, -0.05, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.32, radius * 0.98, 128]} />
        <meshBasicMaterial color={SHOULDER_BLUE} transparent opacity={wide ? 0.08 : 0.16} />
      </mesh>
    </group>
  );
};

const CoachPlayerSkeleton: React.FC<{clip: Clip; player: Player; phase: PhaseId}> = ({clip, player, phase}) => {
  const strikeFoot = String(clip.features.inferred_foot || "right");
  const plantFoot = String(clip.features.plant_foot || "left");
  return (
    <group>
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        const isStrikeLeg = from.startsWith(strikeFoot) || to.startsWith(strikeFoot);
        const isPlantLeg = from.startsWith(plantFoot) || to.startsWith(plantFoot);
        const isUpperAxis = from.includes("shoulder") || to.includes("shoulder") || from.includes("hip") || to.includes("hip");
        const color = isStrikeLeg ? FOOT_VIOLET : isPlantLeg ? PLANT_BLUE : isUpperAxis && phase === "backswing" ? SUBJECT_WHITE : SUBJECT_WHITE;
        const radius = isStrikeLeg || isPlantLeg ? 0.055 : isUpperAxis ? 0.047 : 0.036;
        return <CylinderBetween key={`coach-${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={radius} color={color} opacity={0.96} />;
      })}
      {Object.entries(player.parts).map(([name, point]) => {
        const isStrike = name.startsWith(strikeFoot) && (name.endsWith("toe") || name.endsWith("heel") || name.endsWith("ankle"));
        const isPlant = name.startsWith(plantFoot) && (name.endsWith("toe") || name.endsWith("heel") || name.endsWith("ankle"));
        const color = isStrike ? FOOT_VIOLET : isPlant ? PLANT_BLUE : SUBJECT_WHITE;
        return (
          <mesh key={`coach-dot-${name}`} position={toThree(point)}>
            <sphereGeometry args={[isStrike || isPlant ? 0.095 : 0.068, 14, 14]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isStrike || isPlant ? 0.42 : 0.1} roughness={0.32} />
          </mesh>
        );
      })}
    </group>
  );
};

const SimplePlayerSkeleton: React.FC<{player: Player; color: string; opacity: number; radius: number}> = ({
  player,
  color,
  opacity,
  radius,
}) => (
  <group>
    {BODY_CONNECTIONS.map(([from, to]) => {
      const a = player.parts[from];
      const b = player.parts[to];
      if (!a || !b) return null;
      return <CylinderBetween key={`simple-${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={radius} color={color} opacity={opacity} />;
    })}
  </group>
);

const ApproachGraphics: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({
  clip,
  player,
  ball,
  progress,
}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  if (!strikeFoot) return null;
  const arrowStart = strikeFoot.clone().add(new THREE.Vector3(0, 0.22, 0));
  const arrowEnd = arrowStart.clone().lerp(ball.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.82);
  return (
    <group>
      <AnimatedArrow start={arrowStart} end={arrowEnd} color={ELECTRIC} progress={progress} radius={0.035} />
      <GlowSphere point={strikeFoot} color={ELECTRIC} radius={0.19} opacity={0.54} />
      <GroundRing point={new THREE.Vector3(ball.x, 0.04, ball.z)} color={BALL_BLUE} radius={0.52} opacity={0.8} />
    </group>
  );
};

const BackswingGraphics: React.FC<{clip: Clip; player: Player; progress: number}> = ({clip, player, progress}) => {
  const leftShoulder = player.parts.left_shoulder ? toThree(player.parts.left_shoulder) : null;
  const rightShoulder = player.parts.right_shoulder ? toThree(player.parts.right_shoulder) : null;
  const leftHip = player.parts.left_hip ? toThree(player.parts.left_hip) : null;
  const rightHip = player.parts.right_hip ? toThree(player.parts.right_hip) : null;
  const pelvis = player.parts.pelvis ? toThree(player.parts.pelvis) : null;
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !pelvis) return null;
  const axisProgress = clamp01(interpolate(progress, [0.08, 0.54], [0, 1]));
  const arcProgress = clamp01(interpolate(progress, [0.42, 0.92], [0, 1]));
  return (
    <group>
      <AnimatedCylinder start={leftHip} end={rightHip} color={VIOLET} progress={axisProgress} radius={0.048} />
      <AnimatedCylinder start={leftShoulder} end={rightShoulder} color={ELECTRIC} progress={axisProgress} radius={0.042} />
      <CylinderBetween start={leftHip.clone().lerp(rightHip, 0.5)} end={leftShoulder.clone().lerp(rightShoulder, 0.5)} radius={0.018} color={ICE} opacity={0.2} />
      <AngleArc
        center={pelvis.clone().add(new THREE.Vector3(0, 0.8, 0))}
        shoulderA={leftShoulder}
        shoulderB={rightShoulder}
        hipA={leftHip}
        hipB={rightHip}
        progress={arcProgress}
        shownDegrees={numberValue(clip.features.peak_shoulder_hip_separation_deg)}
      />
    </group>
  );
};

const ContactMeasurements: React.FC<{clip: Clip; player: Player; ball: THREE.Vector3; progress: number}> = ({
  clip,
  player,
  ball,
  progress,
}) => {
  const strikeFoot = strikeFootPoint(clip, player);
  const plantFoot = plantFootPoint(clip, player);
  const lineProgress = clamp01(interpolate(progress, [0.12, 0.58], [0, 1]));
  const rulerProgress = clamp01(interpolate(progress, [0.32, 0.9], [0, 1]));
  return (
    <group>
      {strikeFoot ? (
        <DistanceMeasure start={strikeFoot} end={ball} color={ELECTRIC} progress={lineProgress} radius={0.038} ticks />
      ) : null}
      {plantFoot ? (
        <GroundRuler
          start={new THREE.Vector3(plantFoot.x, 0.08, plantFoot.z)}
          end={new THREE.Vector3(ball.x, 0.08, ball.z)}
          color={PLANT_BLUE}
          progress={rulerProgress}
        />
      ) : null}
      <GroundRing point={new THREE.Vector3(ball.x, 0.04, ball.z)} color={ELECTRIC} radius={0.42} opacity={0.95} />
    </group>
  );
};

const PelvisContinuation: React.FC<{clip: Clip; currentFrame: number; progress: number}> = ({clip, currentFrame, progress}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= currentFrame)
    .map((frame) => shooterForFrame(clip, frame)?.parts.pelvis)
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => toThree(point).add(new THREE.Vector3(0, 0.08, 0)));
  const shown = points.slice(0, Math.max(2, Math.round(points.length * clamp01(progress))));
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={VIOLET} opacity={0.9} />
      <AnimatedArrow
        start={shown[Math.max(0, shown.length - 2)]}
        end={shown[shown.length - 1].clone().add(directionFromPoints(shown).multiplyScalar(0.7))}
        color={VIOLET}
        progress={clamp01(progress * 1.4)}
        radius={0.025}
      />
      {shown.filter((_, index) => index % 4 === 0).map((point, index) => (
        <GlowSphere key={`pelvis-${index}`} point={point} color={VIOLET} radius={0.075} opacity={0.54} />
      ))}
    </group>
  );
};

const FollowFootPath: React.FC<{clip: Clip; currentFrame: number; progress: number}> = ({clip, currentFrame, progress}) => {
  const contact = contactNumber(clip);
  const part = `${String(clip.features.inferred_foot || "right")}_toe`;
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= currentFrame)
    .map((frame) => shooterForFrame(clip, frame)?.parts[part])
    .filter((point): point is Vec3 => Boolean(point))
    .map(toThree);
  const shown = points.slice(0, Math.max(2, Math.round(points.length * clamp01(progress))));
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={ELECTRIC} opacity={0.78} />
      {shown.filter((_, index) => index % 4 === 0).map((point, index) => (
        <GlowSphere key={`follow-foot-${index}`} point={point} color={ELECTRIC} radius={0.07} opacity={0.52} />
      ))}
    </group>
  );
};

const FootTrail: React.FC<{clip: Clip; currentFrame: number; progress: number}> = ({clip, currentFrame, progress}) => {
  const contact = contactNumber(clip);
  const strikeFoot = String(clip.features.inferred_foot || "right");
  const part = `${strikeFoot}_toe`;
  const startFrame = contact - 38;
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= startFrame && frame.frameNumber <= Math.max(currentFrame, startFrame))
    .map((frame) => shooterForFrame(clip, frame)?.parts[part])
    .filter((point): point is Vec3 => Boolean(point))
    .map(toThree);
  const count = Math.max(2, Math.round(points.length * clamp01(progress)));
  const shown = points.slice(0, count);
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={ELECTRIC} opacity={0.86} />
      {shown.filter((_, index) => index % 3 === 0).map((point, index) => (
        <GlowSphere key={`foot-dot-${index}`} point={point} color={ELECTRIC} radius={0.065} opacity={0.62} />
      ))}
    </group>
  );
};

const BallFlightPath: React.FC<{clip: Clip; progress: number}> = ({clip, progress}) => {
  const contact = contactNumber(clip);
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= contact)
    .map((frame) => frame.ball?.position)
    .filter((point): point is Vec3 => Boolean(point))
    .map(toThree);
  const shown = points.slice(0, Math.max(2, Math.round(points.length * clamp01(progress))));
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={BALL_BLUE} opacity={0.96} />
      {shown.filter((_, index) => index % 5 === 0).map((point, index) => (
        <GlowSphere key={`ball-flight-${index}`} point={point} color={BALL_BLUE} radius={0.08} opacity={0.64} />
      ))}
    </group>
  );
};

const ExitVelocityArrow: React.FC<{ball: THREE.Vector3; velocity: Vec3; progress: number}> = ({ball, velocity, progress}) => {
  const end = ball.clone().add(new THREE.Vector3(velocity.x, velocity.z, -velocity.y).multiplyScalar(0.2));
  return <AnimatedArrow start={ball} end={end} color={ELECTRIC} progress={clamp01(progress)} radius={0.03} />;
};

const PlayerSkeleton: React.FC<{clip: Clip; player: Player; phase: PhaseId}> = ({clip, player, phase}) => {
  const strikeFoot = String(clip.features.inferred_foot || "right");
  const plantFoot = String(clip.features.plant_foot || "left");
  return (
    <group>
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        const isStrikeLeg = from.startsWith(strikeFoot) || to.startsWith(strikeFoot);
        const isPlantLeg = from.startsWith(plantFoot) || to.startsWith(plantFoot);
        const isTorso = from.includes("shoulder") || to.includes("shoulder") || from.includes("hip") || to.includes("hip") || from === "neck" || to === "neck";
        const color = isStrikeLeg ? ELECTRIC : isPlantLeg ? PLANT_BLUE : isTorso && phase === "backswing" ? VIOLET : ICE;
        const radius = isStrikeLeg || isPlantLeg ? 0.06 : isTorso ? 0.052 : 0.042;
        return (
          <CylinderBetween
            key={`${from}-${to}`}
            start={toThree(a)}
            end={toThree(b)}
            radius={radius + 0.035}
            color={color}
            opacity={0.16}
          />
        );
      })}
      {BODY_CONNECTIONS.map(([from, to]) => {
        const a = player.parts[from];
        const b = player.parts[to];
        if (!a || !b) return null;
        const isStrikeLeg = from.startsWith(strikeFoot) || to.startsWith(strikeFoot);
        const isPlantLeg = from.startsWith(plantFoot) || to.startsWith(plantFoot);
        const isTorso = from.includes("shoulder") || to.includes("shoulder") || from.includes("hip") || to.includes("hip") || from === "neck" || to === "neck";
        const color = isStrikeLeg ? ELECTRIC : isPlantLeg ? PLANT_BLUE : isTorso && phase === "backswing" ? VIOLET : ICE;
        const radius = isStrikeLeg || isPlantLeg ? 0.052 : isTorso ? 0.045 : 0.035;
        return <CylinderBetween key={`core-${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={radius} color={color} opacity={0.96} />;
      })}
      {Object.entries(player.parts).map(([name, point]) => {
        const isFoot = name.startsWith(strikeFoot) && (name.endsWith("toe") || name.endsWith("heel") || name.endsWith("ankle"));
        const isPlant = name.startsWith(plantFoot) && (name.endsWith("toe") || name.endsWith("heel") || name.endsWith("ankle"));
        const color = isFoot ? ELECTRIC : isPlant ? PLANT_BLUE : ICE;
        return (
          <mesh key={name} position={toThree(point)}>
            <sphereGeometry args={[isFoot || isPlant ? 0.095 : 0.07, 14, 14]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isFoot || isPlant ? 0.45 : 0.14}
              roughness={0.36}
              transparent
              opacity={0.98}
            />
          </mesh>
        );
      })}
    </group>
  );
};

const ContactGhost: React.FC<{player: Player}> = ({player}) => (
  <group>
    {BODY_CONNECTIONS.map(([from, to]) => {
      const a = player.parts[from];
      const b = player.parts[to];
      if (!a || !b) return null;
      return <CylinderBetween key={`ghost-${from}-${to}`} start={toThree(a)} end={toThree(b)} radius={0.022} color={ICE} opacity={0.16} />;
    })}
  </group>
);

/** Lighter wireframe ghost for grounded follow-through (AGY telestration feedback). */
const GroundedContactGhost: React.FC<{player: Player}> = ({player}) => (
  <group>
    {BODY_CONNECTIONS.map(([from, to]) => {
      const a = player.parts[from];
      const b = player.parts[to];
      if (!a || !b) return null;
      return (
        <CylinderBetween
          key={`gnd-ghost-${from}-${to}`}
          start={toThree(a)}
          end={toThree(b)}
          radius={0.018}
          color={MEASURE_CYAN}
          opacity={0.28}
        />
      );
    })}
  </group>
);

const ShooterGroundSpotlight: React.FC<{point: THREE.Vector3; progress: number}> = ({point, progress}) => {
  const scale = clamp01(interpolate(progress, [0.08, 0.55], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}));
  const r = 0.42 + scale * 0.38;
  return (
    <group position={[point.x, point.y, point.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.35, r, 48]} />
        <meshBasicMaterial color={MEASURE_CYAN} transparent opacity={0.14 + scale * 0.22} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.22, 32]} />
        <meshBasicMaterial color={MEASURE_CYAN} transparent opacity={0.35 + scale * 0.25} />
      </mesh>
    </group>
  );
};

const DefenderPressureVolumes: React.FC<{clip: Clip; frame: ShotFrame; progress: number}> = ({
  clip,
  frame,
  progress,
}) => {
  const shooter = shooterForFrame(clip, frame);
  const shooterTeam = shooter?.teamCode;
  const draw = clamp01(interpolate(progress, [0.2, 0.72], [0, 1]));
  if (draw < 0.02) return null;
  return (
    <group>
      {(frame.players || [])
        .filter((p) => p.name !== clip.shot.player && p.teamCode !== shooterTeam && p.parts.pelvis)
        .slice(0, 4)
        .map((player, index) => {
          const pelvis = toThree(player.parts.pelvis!);
          const chest = player.parts.neck
            ? toThree(player.parts.neck)
            : pelvis.clone().add(new THREE.Vector3(0, 0.75, 0));
          return (
            <AnimatedCylinder
              key={`pressure-${player.name || index}`}
              start={groundPoint(pelvis, 0.03)}
              end={chest}
              color={OPPONENT_STEEL}
              progress={draw}
              radius={0.11}
            />
          );
        })}
    </group>
  );
};

const BallMesh: React.FC<{position: THREE.Vector3; phase: PhaseId}> = ({position, phase}) => (
  <group>
    <mesh position={position}>
      <sphereGeometry args={[phase === "output" ? 0.2 : 0.18, 28, 28]} />
      <meshStandardMaterial color="#f7feff" emissive={ELECTRIC} emissiveIntensity={0.24} roughness={0.2} />
    </mesh>
    <GlowSphere point={position} color={BALL_BLUE} radius={0.28} opacity={phase === "contact" ? 0.26 : 0.16} />
  </group>
);

const CloseupFloor: React.FC<{focus: THREE.Vector3; phase: PhaseId}> = ({focus, phase}) => {
  const radius = phase === "output" ? 13.5 : 5.4;
  return (
    <group>
      <mesh position={[focus.x, -0.055, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 96]} />
        <meshStandardMaterial color="#06142b" roughness={0.84} metalness={0.06} />
      </mesh>
      <mesh position={[focus.x, -0.048, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.35, radius * 0.96, 96]} />
        <meshBasicMaterial color={ELECTRIC_DEEP} transparent opacity={phase === "output" ? 0.1 : 0.18} />
      </mesh>
    </group>
  );
};

/** Subtle pitch lines + goal mouth hint (Statsbomb-style spatial context, no neon grid). */
const GroundedPitchContext: React.FC<{focus: THREE.Vector3; clip: Clip}> = ({focus, clip}) => {
  const direction = new THREE.Vector3(
    numberValue(clip.features.shot_direction_x),
    0,
    -numberValue(clip.features.shot_direction_y),
  );
  const unit = direction.length() > 0.001 ? direction.normalize() : new THREE.Vector3(-1, 0, 0);
  const side = new THREE.Vector3(-unit.z, 0, unit.x);
  const y = 0.015;
  const lines: THREE.Vector3[][] = [];
  for (let i = -7; i <= 7; i++) {
    const along = unit.clone().multiplyScalar(i);
    lines.push([
      focus.clone().add(side.clone().multiplyScalar(-5)).add(along).setY(y),
      focus.clone().add(side.clone().multiplyScalar(5)).add(along).setY(y),
    ]);
    const across = side.clone().multiplyScalar(i);
    lines.push([
      focus.clone().add(unit.clone().multiplyScalar(-5)).add(across).setY(y),
      focus.clone().add(unit.clone().multiplyScalar(5)).add(across).setY(y),
    ]);
  }
  const goalCenter = focus.clone().add(unit.clone().multiplyScalar(11));
  [-3.6, 3.6].forEach((offset) => {
    const post = side.clone().multiplyScalar(offset);
    lines.push([
      goalCenter.clone().add(post).setY(y),
      goalCenter.clone().add(post).add(new THREE.Vector3(0, 2.44, 0)).setY(y + 2.44),
    ]);
  });
  lines.push([
    goalCenter.clone().add(side.clone().multiplyScalar(-3.6)).setY(y),
    goalCenter.clone().add(side.clone().multiplyScalar(3.6)).setY(y),
  ]);
  return (
    <group>
      {lines.map((points, index) => (
        <LineMesh key={`pitch-${index}`} points={points} color="rgba(232, 240, 248, 0.22)" opacity={0.14} />
      ))}
    </group>
  );
};

const ReferenceGrid: React.FC<{focus: THREE.Vector3}> = ({focus}) => {
  const lines: THREE.Vector3[][] = [];
  for (let offset = -5; offset <= 5; offset += 1) {
    lines.push([
      new THREE.Vector3(focus.x - 5.5, 0.01, focus.z + offset),
      new THREE.Vector3(focus.x + 5.5, 0.01, focus.z + offset),
    ]);
    lines.push([
      new THREE.Vector3(focus.x + offset, 0.01, focus.z - 5.5),
      new THREE.Vector3(focus.x + offset, 0.01, focus.z + 5.5),
    ]);
  }
  return (
    <group>
      {lines.map((points, index) => (
        <LineMesh key={`grid-${index}`} points={points} color={GRID} opacity={0.16} />
      ))}
    </group>
  );
};

const GoalHint: React.FC<{clip: Clip}> = ({clip}) => {
  const contact = nearestFrame(clip, contactNumber(clip));
  const ball = contact.ball?.position ? toThree(contact.ball.position) : new THREE.Vector3(0, 0, 0);
  const direction = new THREE.Vector3(
    numberValue(clip.features.shot_direction_x),
    0,
    -numberValue(clip.features.shot_direction_y),
  );
  const unit = direction.length() > 0.001 ? direction.normalize() : new THREE.Vector3(-1, 0, 0);
  const start = ball.clone().add(unit.clone().multiplyScalar(5.5));
  const end = ball.clone().add(unit.clone().multiplyScalar(14));
  return (
    <group>
      <LineMesh points={[start, end]} color={ELECTRIC_DEEP} opacity={0.32} />
      {[-1.2, 0, 1.2].map((offset) => {
        const side = new THREE.Vector3(-unit.z, 0, unit.x).multiplyScalar(offset);
        return (
          <LineMesh
            key={`lane-${offset}`}
            points={[start.clone().add(side), end.clone().add(side)]}
            color={BALL_BLUE}
            opacity={offset === 0 ? 0.22 : 0.14}
          />
        );
      })}
    </group>
  );
};

const ContactPulse: React.FC<{position: THREE.Vector3; progress: number}> = ({position, progress}) => {
  const radius = 0.34 + Math.sin(progress * Math.PI) * 0.18;
  return (
    <group>
      <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.026, 12, 48]} />
        <meshBasicMaterial color={ELECTRIC} transparent opacity={0.78} />
      </mesh>
      <pointLight position={position} color={ELECTRIC} intensity={1.1 + progress * 1.6} distance={3.6} />
    </group>
  );
};

const DistanceMeasure: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  progress: number;
  radius: number;
  ticks?: boolean;
}> = ({start, end, color, progress, radius, ticks = false}) => {
  const clamped = clamp01(progress);
  const shownEnd = start.clone().lerp(end, clamped);
  const direction = end.clone().sub(start);
  const flat = new THREE.Vector3(direction.x, 0, direction.z);
  const normal = flat.length() > 0.001 ? new THREE.Vector3(-flat.z, 0, flat.x).normalize().multiplyScalar(0.22) : new THREE.Vector3(0.22, 0, 0);
  return (
    <group>
      <CylinderBetween start={start} end={end} radius={radius * 0.4} color={color} opacity={0.18} />
      {clamped > 0.02 ? <CylinderBetween start={start} end={shownEnd} radius={radius} color={color} opacity={0.96} /> : null}
      {ticks ? <CylinderBetween start={start.clone().sub(normal)} end={start.clone().add(normal)} radius={radius * 0.62} color={color} opacity={0.9} /> : null}
      {ticks && clamped > 0.92 ? <CylinderBetween start={end.clone().sub(normal)} end={end.clone().add(normal)} radius={radius * 0.62} color={color} opacity={0.9} /> : null}
      <GlowSphere point={start} color={color} radius={0.1} opacity={0.85} />
      <GlowSphere point={shownEnd} color={color} radius={0.1} opacity={0.85} />
    </group>
  );
};

const GroundRuler: React.FC<{start: THREE.Vector3; end: THREE.Vector3; color: string; progress: number}> = ({
  start,
  end,
  color,
  progress,
}) => {
  const lift = new THREE.Vector3(0, 0.28, 0);
  const raisedStart = start.clone().add(lift);
  const raisedEnd = end.clone().add(lift);
  const shownEnd = raisedStart.clone().lerp(raisedEnd, clamp01(progress));
  return (
    <group>
      <CylinderBetween start={start} end={raisedStart} radius={0.015} color={color} opacity={0.58} />
      {progress > 0.72 ? <CylinderBetween start={end} end={raisedEnd} radius={0.015} color={color} opacity={0.58} /> : null}
      <DistanceMeasure start={raisedStart} end={raisedEnd} color={color} progress={progress} radius={0.03} ticks />
      <CylinderBetween start={raisedStart} end={shownEnd} radius={0.045} color={color} opacity={0.36} />
      <GroundRing point={start} color={color} radius={0.24} opacity={0.68} />
      <GroundRing point={end} color={ELECTRIC} radius={0.34} opacity={0.62} />
    </group>
  );
};

const AngleArc: React.FC<{
  center: THREE.Vector3;
  shoulderA: THREE.Vector3;
  shoulderB: THREE.Vector3;
  hipA: THREE.Vector3;
  hipB: THREE.Vector3;
  progress: number;
  shownDegrees: number;
}> = ({center, shoulderA, shoulderB, hipA, hipB, progress, shownDegrees}) => {
  const points = useMemo(() => {
    const hipAngle = axisAngle(hipA, hipB);
    const shoulderAngle = axisAngle(shoulderA, shoulderB);
    const dataDelta = Number.isNaN(shownDegrees) ? shortestAngleDelta(hipAngle, shoulderAngle) : THREE.MathUtils.degToRad(shownDegrees);
    const signedDelta = Math.sign(shortestAngleDelta(hipAngle, shoulderAngle)) || 1;
    const delta = Math.abs(dataDelta) * signedDelta;
    const steps = 36;
    const shown = Math.max(1, Math.round(steps * clamp01(progress)));
    return Array.from({length: shown + 1}, (_, index) => {
      const amount = index / steps;
      const angle = hipAngle + delta * amount;
      return new THREE.Vector3(center.x + Math.cos(angle) * 0.86, center.y, center.z + Math.sin(angle) * 0.86);
    });
  }, [center, hipA, hipB, progress, shoulderA, shoulderB, shownDegrees]);
  return (
    <group>
      <LineMesh points={points} color={ELECTRIC} opacity={0.98} />
      {points.length > 1 ? <GlowSphere point={points[points.length - 1]} color={ELECTRIC} radius={0.095} opacity={0.8} /> : null}
    </group>
  );
};

const PlanarAngleArc: React.FC<{
  center: THREE.Vector3;
  fromAngle: number;
  toAngle: number;
  radius: number;
  color: string;
  progress: number;
}> = ({center, fromAngle, toAngle, radius, color, progress}) => {
  const points = useMemo(() => {
    const delta = shortestAngleDelta(fromAngle, toAngle);
    const steps = 36;
    const shown = Math.max(2, Math.round(steps * clamp01(progress)));
    return Array.from({length: shown + 1}, (_, index) => {
      const amount = index / steps;
      const angle = fromAngle + delta * amount;
      return new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius);
    });
  }, [center, color, fromAngle, progress, radius, toAngle]);
  return (
    <group>
      <LineMesh points={points} color={color} opacity={0.96} />
      <GlowSphere point={points[points.length - 1]} color={color} radius={0.08} opacity={0.76} />
    </group>
  );
};

const LaunchAngleArc: React.FC<{ball: THREE.Vector3; velocity: Vec3; progress: number}> = ({ball, velocity, progress}) => {
  const points = useMemo(() => {
    const horizontal = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    const angle = Math.atan2(velocity.z, horizontal || 0.001);
    const shotDir = new THREE.Vector3(velocity.x, 0, -velocity.y);
    const flatDir = shotDir.length() > 0.001 ? shotDir.normalize() : new THREE.Vector3(1, 0, 0);
    const steps = 32;
    const shown = Math.max(2, Math.round(steps * clamp01(progress)));
    const radius = 0.86;
    return Array.from({length: shown + 1}, (_, index) => {
      const amount = index / steps;
      const theta = angle * amount;
      return ball
        .clone()
        .add(flatDir.clone().multiplyScalar(Math.cos(theta) * radius))
        .add(new THREE.Vector3(0, Math.sin(theta) * radius + 0.16, 0));
    });
  }, [ball, progress, velocity.x, velocity.y, velocity.z]);
  const baseEnd = points[0]?.clone().add(new THREE.Vector3(1.1, 0, 0));
  return (
    <group>
      {points[0] && baseEnd ? <LineMesh points={[points[0], baseEnd]} color={OPPONENT_STEEL} opacity={0.32} /> : null}
      <LineMesh points={points} color={MEASURE_CYAN} opacity={0.96} />
      <GlowSphere point={points[points.length - 1]} color={MEASURE_CYAN} radius={0.08} opacity={0.76} />
    </group>
  );
};

const AnimatedArrow: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  progress: number;
  radius: number;
}> = ({start, end, color, progress, radius}) => {
  const clamped = clamp01(progress);
  const currentEnd = start.clone().lerp(end, clamped);
  const direction = end.clone().sub(start);
  if (direction.length() < 0.001 || clamped <= 0.01) return null;
  const headDirection = direction.clone().normalize();
  const headBase = currentEnd.clone().sub(headDirection.clone().multiplyScalar(0.34));
  return (
    <group>
      <CylinderBetween start={start} end={currentEnd} radius={radius} color={color} opacity={0.95} />
      {clamped > 0.72 ? <ConeBetween start={headBase} end={currentEnd} radius={radius * 3.1} color={color} opacity={0.98} /> : null}
      <GlowSphere point={currentEnd} color={color} radius={radius * 2.6} opacity={0.42} />
    </group>
  );
};

const AnimatedCylinder: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  progress: number;
  radius: number;
}> = ({start, end, color, progress, radius}) => {
  const currentEnd = start.clone().lerp(end, clamp01(progress));
  if (progress <= 0.01) return null;
  return <CylinderBetween start={start} end={currentEnd} radius={radius} color={color} opacity={0.96} />;
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
  if (length < 0.001) return null;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 12]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.28} emissive={color} emissiveIntensity={0.12} />
    </mesh>
  );
};

const ConeBetween: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  opacity: number;
}> = ({start, end, radius, color, opacity}) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.001) return null;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <coneGeometry args={[radius, length, 16]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.24} emissive={color} emissiveIntensity={0.22} />
    </mesh>
  );
};

const LineMesh: React.FC<{points: THREE.Vector3[]; color: string; opacity: number}> = ({points, color, opacity}) => {
  const line = useMemo(
    () =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({color, transparent: true, opacity}),
      ),
    [color, opacity, points],
  );
  return <primitive object={line} />;
};

const GlowSphere: React.FC<{point: THREE.Vector3; color: string; radius: number; opacity: number}> = ({
  point,
  color,
  radius,
  opacity,
}) => (
  <mesh position={point}>
    <sphereGeometry args={[radius, 18, 18]} />
    <meshBasicMaterial color={color} transparent opacity={opacity} />
  </mesh>
);

const GroundRing: React.FC<{point: THREE.Vector3; color: string; radius: number; opacity: number}> = ({
  point,
  color,
  radius,
  opacity,
}) => (
  <mesh position={point} rotation={[Math.PI / 2, 0, 0]}>
    <torusGeometry args={[radius, 0.018, 10, 42]} />
    <meshBasicMaterial color={color} transparent opacity={opacity} />
  </mesh>
);

const GroundRibbonArrow: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  progress: number;
  width: number;
  opacity: number;
}> = ({start, end, color, progress, width, opacity}) => {
  const clamped = clamp01(progress);
  const currentEnd = start.clone().lerp(end, clamped);
  const direction = end.clone().sub(start);
  direction.y = 0;
  if (direction.length() < 0.001 || clamped <= 0.01) return null;
  const unit = direction.normalize();
  const distance = currentEnd.clone().sub(start).length();
  const headLength = Math.min(Math.max(width * 2.6, 0.34), Math.max(0.18, distance * 0.46));
  const bodyEnd = currentEnd.clone().sub(unit.clone().multiplyScalar(Math.min(headLength, distance * 0.72)));

  return (
    <group>
      <GroundRibbonSegment start={start} end={currentEnd} color={color} width={width * 1.85} opacity={opacity * 0.16} y={start.y - 0.012} />
      {distance > headLength * 0.65 ? (
        <GroundRibbonSegment start={start} end={bodyEnd} color={color} width={width} opacity={opacity} y={start.y} />
      ) : null}
      {clamped > 0.68 ? (
        <GroundArrowHead
          tip={currentEnd}
          direction={unit}
          color={color}
          width={width * 2.35}
          length={headLength}
          opacity={Math.min(0.98, opacity + 0.12)}
          y={start.y + 0.004}
        />
      ) : null}
      <GlowSphere point={currentEnd.clone().setY(start.y + 0.035)} color={color} radius={width * 0.9} opacity={0.34} />
    </group>
  );
};

const GroundRibbonSegment: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  width: number;
  opacity: number;
  y?: number;
}> = ({start, end, color, width, opacity, y}) => {
  const geometry = useMemo(() => groundQuadGeometry(start, end, width, y ?? start.y), [end, start, width, y]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={12}>
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
};

const GroundArrowHead: React.FC<{
  tip: THREE.Vector3;
  direction: THREE.Vector3;
  color: string;
  width: number;
  length: number;
  opacity: number;
  y: number;
}> = ({tip, direction, color, width, length, opacity, y}) => {
  const geometry = useMemo(() => {
    const unit = direction.clone();
    unit.y = 0;
    if (unit.length() < 0.001) return null;
    unit.normalize();
    const side = new THREE.Vector3(-unit.z, 0, unit.x).multiplyScalar(width * 0.5);
    const base = new THREE.Vector3(tip.x, y, tip.z).sub(unit.multiplyScalar(length));
    const vertices = [
      tip.x, y, tip.z,
      base.x + side.x, y, base.z + side.z,
      base.x - side.x, y, base.z - side.z,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  }, [direction, length, tip, width, y]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={13}>
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
};

const GroundDistanceRuler: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  progress: number;
  compact?: boolean;
}> = ({start, end, color, progress, compact = false}) => {
  const clamped = clamp01(progress);
  const shownEnd = start.clone().lerp(end, clamped);
  const direction = end.clone().sub(start);
  direction.y = 0;
  if (direction.length() < 0.001 || clamped <= 0.01) return null;
  const unit = direction.normalize();
  const side = new THREE.Vector3(-unit.z, 0, unit.x).multiplyScalar(compact ? 0.2 : 0.34);
  const width = compact ? 0.055 : 0.07;

  return (
    <group>
      <GroundRibbonSegment start={start} end={shownEnd} color={color} width={width} opacity={0.88} />
      <GroundRibbonSegment start={start.clone().sub(side)} end={start.clone().add(side)} color={color} width={width * 0.75} opacity={0.78} />
      {clamped > 0.88 ? (
        <GroundRibbonSegment end={end.clone().add(side)} start={end.clone().sub(side)} color={color} width={width * 0.75} opacity={0.78} />
      ) : null}
      <GroundRing point={start.clone().setY(start.y + 0.012)} color={color} radius={compact ? 0.18 : 0.25} opacity={0.58} />
      <GroundRing point={shownEnd.clone().setY(start.y + 0.012)} color={color} radius={compact ? 0.2 : 0.3} opacity={0.72} />
    </group>
  );
};

const GroundAngleGauge: React.FC<{
  center: THREE.Vector3;
  fromAngle: number;
  toAngle: number;
  radius: number;
  color: string;
  progress: number;
}> = ({center, fromAngle, toAngle, radius, color, progress}) => {
  const clamped = clamp01(progress);
  const delta = shortestAngleDelta(fromAngle, toAngle);
  const currentAngle = fromAngle + delta * clamped;
  const points = useMemo(() => arcPoints(center, fromAngle, currentAngle, radius, 38), [center, currentAngle, fromAngle, radius]);
  const fromEnd = center.clone().add(new THREE.Vector3(Math.cos(fromAngle) * radius, 0, Math.sin(fromAngle) * radius));
  const toEnd = center.clone().add(new THREE.Vector3(Math.cos(currentAngle) * radius, 0, Math.sin(currentAngle) * radius));

  return (
    <group>
      <GroundSector center={center} points={points} color={color} opacity={0.14} />
      <GroundRibbonSegment start={center} end={fromEnd} color={OPPONENT_STEEL} width={0.03} opacity={0.34} />
      <GroundRibbonSegment start={center} end={toEnd} color={color} width={0.04} opacity={0.8} />
      <GroundArcRibbon points={points} color={color} width={0.055} opacity={0.9} />
      {points.length > 1 ? <GlowSphere point={points[points.length - 1].clone().setY(center.y + 0.04)} color={color} radius={0.075} opacity={0.72} /> : null}
    </group>
  );
};

const BodyAngleGauge: React.FC<{
  center: THREE.Vector3;
  fromAngle: number;
  toAngle: number;
  radius: number;
  color: string;
  progress: number;
}> = ({center, fromAngle, toAngle, radius, color, progress}) => {
  const clamped = clamp01(progress);
  const currentAngle = fromAngle + shortestAngleDelta(fromAngle, toAngle) * clamped;
  const points = useMemo(() => arcPoints(center, fromAngle, currentAngle, radius, 36), [center, currentAngle, fromAngle, radius]);
  const fromEnd = center.clone().add(new THREE.Vector3(Math.cos(fromAngle) * radius, 0, Math.sin(fromAngle) * radius));
  const toEnd = center.clone().add(new THREE.Vector3(Math.cos(currentAngle) * radius, 0, Math.sin(currentAngle) * radius));

  return (
    <group>
      <OverlayCylinderBetween start={center} end={fromEnd} radius={0.022} color={OPPONENT_STEEL} opacity={0.46} />
      <OverlayCylinderBetween start={center} end={toEnd} radius={0.034} color={color} opacity={0.88} />
      <ArcCylinderSegments points={points} color={color} radius={0.04} opacity={0.98} />
      {points.filter((_, index) => index % 8 === 0).map((point, index) => (
        <GlowSphere key={`body-angle-dot-${index}`} point={point} color={color} radius={0.055} opacity={0.65} />
      ))}
      {points.length > 1 ? <GlowSphere point={points[points.length - 1]} color={color} radius={0.11} opacity={0.85} /> : null}
    </group>
  );
};

const GroundSector: React.FC<{center: THREE.Vector3; points: THREE.Vector3[]; color: string; opacity: number}> = ({
  center,
  points,
  color,
  opacity,
}) => {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const vertices = [center.x, center.y - 0.002, center.z];
    points.forEach((point) => vertices.push(point.x, center.y - 0.002, point.z));
    const indices: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      indices.push(0, i, i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [center, points]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={10}>
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
};

const GroundArcRibbon: React.FC<{points: THREE.Vector3[]; color: string; width: number; opacity: number}> = ({
  points,
  color,
  width,
  opacity,
}) => {
  if (points.length < 2) return null;
  return (
    <group>
      {points.slice(1).map((point, index) => (
        <GroundRibbonSegment
          key={`ground-arc-${index}`}
          start={points[index]}
          end={point}
          color={color}
          width={width}
          opacity={opacity}
          y={point.y + 0.004}
        />
      ))}
    </group>
  );
};

const ArcCylinderSegments: React.FC<{points: THREE.Vector3[]; color: string; radius: number; opacity: number}> = ({
  points,
  color,
  radius,
  opacity,
}) => {
  if (points.length < 2) return null;
  return (
    <group>
      {points.slice(1).map((point, index) => (
        <OverlayCylinderBetween
          key={`arc-cylinder-${index}`}
          start={points[index]}
          end={point}
          radius={radius}
          color={color}
          opacity={opacity}
        />
      ))}
    </group>
  );
};

const ExtendedAxisBar: React.FC<{
  center: THREE.Vector3;
  angle: number;
  color: string;
  progress: number;
  length: number;
}> = ({center, angle, color, progress, length}) => {
  const clamped = clamp01(progress);
  if (clamped <= 0.02) return null;
  const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const half = (length * clamped) / 2;
  const start = center.clone().sub(direction.clone().multiplyScalar(half));
  const end = center.clone().add(direction.clone().multiplyScalar(half));
  return (
    <group>
      <OverlayCylinderBetween start={start} end={end} radius={0.026} color={color} opacity={0.72} />
      <GlowSphere point={start} color={color} radius={0.07} opacity={0.55} />
      <GlowSphere point={end} color={color} radius={0.07} opacity={0.55} />
    </group>
  );
};

const OverlayCylinderBetween: React.FC<{
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  opacity: number;
}> = ({start, end, radius, color, opacity}) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.001) return null;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return (
    <mesh position={midpoint} quaternion={quaternion} renderOrder={24}>
      <cylinderGeometry args={[radius, radius, length, 14]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} depthTest={false} />
    </mesh>
  );
};

const AxisEndpointSpheres: React.FC<{points: THREE.Vector3[]; color: string; progress: number}> = ({points, color, progress}) => {
  if (progress < 0.2) return null;
  return (
    <group>
      {points.map((point, index) => (
        <GlowSphere key={`axis-end-${index}`} point={point} color={color} radius={0.11} opacity={0.68} />
      ))}
    </group>
  );
};

const GroundTrail: React.FC<{
  clip: Clip;
  startFrame: number;
  endFrame: number;
  part: string;
  progress: number;
  color: string;
  width?: number;
}> = ({clip, startFrame, endFrame, part, progress, color, width = 0.06}) => {
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= startFrame && frame.frameNumber <= endFrame)
    .map((frame) => shooterForFrame(clip, frame)?.parts[part])
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => groundPoint(toThree(point), 0.052));
  const shown = points.slice(0, Math.max(2, Math.round(points.length * clamp01(progress))));
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={color} opacity={0.78} />
      {shown.slice(1).map((point, index) => (
        index % 3 === 0 ? <GroundRing key={`ground-trail-dot-${part}-${index}`} point={point} color={color} radius={width * 1.45} opacity={0.42} /> : null
      ))}
    </group>
  );
};

const GroundBallPathShadow: React.FC<{clip: Clip; startFrame: number; progress: number}> = ({clip, startFrame, progress}) => {
  const points = clip.frames
    .filter((frame) => frame.frameNumber >= startFrame)
    .map((frame) => frame.ball?.position)
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => groundPoint(toThree(point), 0.05));
  const shown = points.slice(0, Math.max(2, Math.round(points.length * clamp01(progress))));
  if (shown.length < 2) return null;
  return (
    <group>
      <LineMesh points={shown} color={BALL_BLUE} opacity={0.5} />
      {shown.filter((_, index) => index % 6 === 0).map((point, index) => (
        <GroundRing key={`ball-shadow-${index}`} point={point} color={BALL_BLUE} radius={0.12} opacity={0.36} />
      ))}
    </group>
  );
};

const groundPoint = (point: THREE.Vector3, y = 0.04) => new THREE.Vector3(point.x, y, point.z);

const groundQuadGeometry = (start: THREE.Vector3, end: THREE.Vector3, width: number, y: number) => {
  const direction = end.clone().sub(start);
  direction.y = 0;
  if (direction.length() < 0.001) return null;
  direction.normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(width * 0.5);
  const s = new THREE.Vector3(start.x, y, start.z);
  const e = new THREE.Vector3(end.x, y, end.z);
  const vertices = [
    s.x + side.x, s.y, s.z + side.z,
    s.x - side.x, s.y, s.z - side.z,
    e.x - side.x, e.y, e.z - side.z,
    e.x + side.x, e.y, e.z + side.z,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
};

const arcPoints = (center: THREE.Vector3, fromAngle: number, toAngle: number, radius: number, steps: number) => {
  const count = Math.max(2, Math.round(steps));
  return Array.from({length: count + 1}, (_, index) => {
    const amount = index / count;
    const angle = fromAngle + (toAngle - fromAngle) * amount;
    return new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius);
  });
};

const CameraRig: React.FC<{position: THREE.Vector3; target: THREE.Vector3; fov: number}> = ({
  position,
  target,
  fov,
}) => {
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

const coachPhaseForFrame = (frame: number): CoachPhaseState => {
  const absoluteFrame = ((frame % COACH_TOTAL_FRAMES) + COACH_TOTAL_FRAMES) % COACH_TOTAL_FRAMES;
  const index = Math.min(COACH_PHASES.length - 1, Math.floor(absoluteFrame / COACH_PHASE_FRAMES));
  return {
    id: COACH_PHASES[index].id,
    localFrame: absoluteFrame - index * COACH_PHASE_FRAMES,
    index,
    absoluteFrame,
  };
};

const frameForCoachPhase = (clip: Clip, phase: CoachPhaseId, localFrame: number): ShotFrame => {
  const contact = contactNumber(clip);
  const progress = coachPhaseDataProgress(localFrame);
  if (phase === "context") {
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, contact - 44), Math.max(clip.frameWindow.start, contact - 14), progress));
  }
  if (phase === "approach") {
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, contact - 38), contact, progress));
  }
  if (phase === "backswing") {
    const peak = numberValue(clip.features.peak_shoulder_hip_frame);
    const peakFrame = Number.isNaN(peak) ? contact - 9 : peak;
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, peakFrame - 8), Math.min(contact, peakFrame + 5), progress));
  }
  if (phase === "contact") return nearestFrame(clip, contact);
  if (phase === "follow") {
    return interpolatedFrame(clip, lerp(contact, Math.min(clip.frameWindow.end, contact + 28), progress));
  }
  return interpolatedFrame(clip, lerp(contact, clip.frameWindow.end, progress));
};

/** AGY-paced source scrub for PhaseMechanicsGroundedA4 (465 frames). */
const frameForGroundedCoachPhase = (clip: Clip, phase: CoachPhaseId, localFrame: number): ShotFrame => {
  const contact = contactNumber(clip);
  const phaseFrames = COACH_PHASE_FRAME_COUNTS[phase];
  const progress = groundedCoachPhaseDataProgress(localFrame, phaseFrames);
  if (phase === "context") {
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, contact - 44), Math.max(clip.frameWindow.start, contact - 14), progress));
  }
  if (phase === "approach") {
    return interpolatedFrame(clip, lerp(contact - 38, contact - 18, progress));
  }
  if (phase === "backswing") {
    return interpolatedFrame(clip, lerp(contact - 18, contact - 5, progress));
  }
  if (phase === "contact") {
    if (localFrame < P4_IMPACT_FRAME) {
      const runup = groundedCoachPhaseDataProgress(localFrame, P4_IMPACT_FRAME);
      return interpolatedFrame(clip, lerp(contact - 5, contact, runup));
    }
    if (localFrame < P4_FREEZE_END) {
      return nearestFrame(clip, contact);
    }
    const followProgress = groundedCoachPhaseDataProgress(localFrame - P4_FREEZE_END, P4_FOLLOW_END - P4_FREEZE_END);
    return interpolatedFrame(clip, lerp(contact, Math.min(clip.frameWindow.end, contact + 28), followProgress));
  }
  if (phase === "follow") {
    return interpolatedFrame(clip, lerp(contact, Math.min(clip.frameWindow.end, contact + 28), progress));
  }
  return interpolatedFrame(clip, lerp(contact, clip.frameWindow.end, progress));
};

const groundedA4CameraForPhase = (
  clip: Clip,
  phaseState: CoachPhaseState,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
): CameraState => {
  const {id: phase, localFrame, index, phaseFrames: pfIn} = phaseState;
  const phaseFrames = pfIn ?? COACH_PHASE_FRAME_COUNTS[phase];

  const computeAt = (phaseId: CoachPhaseId, lf: number, frames: number): CameraState => {
    if (phaseId === "contact") {
      return groundedContactCamera(
        lf,
        contactFocus(clip, contactFrame),
        contactFocus(clip, shotFrame),
      );
    }
    const progress = groundedCoachPhaseProgress(lf, frames);
    return groundedCameraForPhase(clip, phaseId, lf, shotFrame, contactFrame, progress);
  };

  const current = computeAt(phase, localFrame, phaseFrames);
  if (index > 0 && localFrame < 15) {
    const prevId = COACH_PHASE_IDS[index - 1] as CoachPhaseId;
    const prevFrames = COACH_PHASE_FRAME_COUNTS[prevId];
    const previous = computeAt(prevId, prevFrames - 1, prevFrames);
    return blendFromPreviousPhaseCamera(index, localFrame, previous, current);
  }
  return current;
};

const coachCameraForPhase = (
  clip: Clip,
  phase: CoachPhaseId,
  localFrame: number,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
) => {
  const progress = coachPhaseProgress(localFrame);
  const contactTarget = contactFocus(clip, contactFrame);
  const liveTarget = contactFocus(clip, shotFrame);
  let target = contactTarget;
  let radius = 5;
  let height = 2.2;
  let angle = -0.7;
  let fov = 33;

  if (phase === "context") {
    target = contactTarget.clone().lerp(liveTarget, 0.38).add(new THREE.Vector3(0, 0.24, 0));
    radius = lerp(12.6, 10.8, progress);
    height = lerp(4.8, 4.25, progress);
    angle = lerp(-1.08, -0.82, progress);
    fov = lerp(46, 42, progress);
  } else if (phase === "approach") {
    target = liveTarget.add(new THREE.Vector3(0, 0.08, 0));
    radius = lerp(6.1, 3.65, progress);
    height = lerp(2.65, 1.72, progress);
    angle = lerp(-0.96, -0.52, progress);
    fov = lerp(38, 30, progress);
  } else if (phase === "backswing") {
    target = torsoFocus(clip, shotFrame).lerp(contactTarget, 0.22).add(new THREE.Vector3(0, 0.08, 0));
    radius = lerp(5.65, 5.05, progress);
    height = lerp(2.5, 2.15, progress);
    angle = lerp(-0.82, -0.18, progress);
    fov = 39;
  } else if (phase === "contact") {
    target = contactTarget.add(new THREE.Vector3(0, 0.02, 0));
    radius = lerp(3.9, 3.05, progress);
    height = lerp(1.9, 1.45, progress);
    angle = lerp(-0.58, -0.38, progress);
    fov = 28;
  } else if (phase === "follow") {
    target = torsoFocus(clip, shotFrame).lerp(contactTarget, 0.2).add(new THREE.Vector3(0, 0.12, 0));
    radius = lerp(3.8, 4.55, progress);
    height = lerp(1.86, 2.25, progress);
    angle = lerp(-0.44, -0.04, progress);
    fov = lerp(29, 32, progress);
  } else {
    target = contactTarget.clone().lerp(liveTarget, lerp(0.2, 0.48, progress)).add(new THREE.Vector3(0, 0.28, 0));
    radius = lerp(6.0, 8.3, progress);
    height = lerp(2.76, 3.8, progress);
    angle = lerp(-0.25, 0.2, progress);
    fov = lerp(36, 41, progress);
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
};

const groundedCameraForPhase = (
  clip: Clip,
  phase: CoachPhaseId,
  localFrame: number,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
  progressOverride?: number,
) => {
  const progress = progressOverride ?? coachPhaseProgress(localFrame);
  const base = coachCameraForPhase(clip, phase, localFrame, shotFrame, contactFrame);
  const contactTarget = contactFocus(clip, contactFrame);
  const liveTarget = contactFocus(clip, shotFrame);
  let target = base.target.clone();
  let radius = base.position.clone().sub(base.target).setY(0).length();
  let height = base.position.y - base.target.y;
  let angle = Math.atan2(base.position.z - base.target.z, base.position.x - base.target.x);
  let fov = base.fov;

  if (phase === "approach") {
    target = liveTarget.clone().lerp(contactTarget, 0.32).add(new THREE.Vector3(0, -0.05, 0));
    radius = lerp(5.5, 3.2, progress);
    height = lerp(2.15, 1.28, progress);
    angle = lerp(-0.9, -0.45, progress);
    fov = lerp(35, 27, progress);
  } else if (phase === "backswing") {
    target = torsoFocus(clip, shotFrame).clone().lerp(contactTarget, 0.2).add(new THREE.Vector3(0, 0.08, 0));
    radius = lerp(4.7, 4.15, progress);
    height = lerp(2.08, 1.82, progress);
    angle = lerp(-0.75, -0.1, progress);
    fov = 34;
  } else if (phase === "contact") {
    target = contactTarget.clone().add(new THREE.Vector3(0, -0.02, 0));
    radius = lerp(3.45, 2.58, progress);
    height = lerp(1.58, 1.12, progress);
    angle = lerp(-0.54, -0.34, progress);
    fov = 25;
  } else if (phase === "follow") {
    target = torsoFocus(clip, shotFrame).clone().lerp(contactTarget, 0.28).add(new THREE.Vector3(0, 0.02, 0));
    radius = lerp(3.3, 4.05, progress);
    height = lerp(1.35, 1.95, progress);
    angle = lerp(-0.4, 0.04, progress);
    fov = lerp(27, 31, progress);
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
};

const phaseForFrame = (frame: number) => {
  const absoluteFrame = ((frame % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES;
  const index = Math.min(PHASES.length - 1, Math.floor(absoluteFrame / PHASE_FRAMES));
  return {
    id: PHASES[index].id,
    localFrame: absoluteFrame - index * PHASE_FRAMES,
    index,
    absoluteFrame,
  };
};

const frameForPhase = (clip: Clip, phase: PhaseId, localFrame: number): ShotFrame => {
  const contact = contactNumber(clip);
  const progress = phaseDataProgress(localFrame);
  if (phase === "approach") {
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, contact - 38), contact, progress));
  }
  if (phase === "backswing") {
    const peak = numberValue(clip.features.peak_shoulder_hip_frame);
    const peakFrame = Number.isNaN(peak) ? contact - 9 : peak;
    return interpolatedFrame(clip, lerp(Math.max(clip.frameWindow.start, peakFrame - 7), Math.min(contact, peakFrame + 5), progress));
  }
  if (phase === "contact") return nearestFrame(clip, contact);
  if (phase === "follow") {
    return interpolatedFrame(clip, lerp(contact, Math.min(clip.frameWindow.end, contact + 25), progress));
  }
  return interpolatedFrame(clip, lerp(contact, clip.frameWindow.end, progress));
};

const cameraForPhase = (
  clip: Clip,
  phase: PhaseId,
  localFrame: number,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
) => {
  const progress = phaseProgress(localFrame);
  const contactTarget = contactFocus(clip, contactFrame);
  const liveTarget = contactFocus(clip, shotFrame);
  let target = contactTarget;
  let radius = 5;
  let height = 2.3;
  let angle = -0.72;
  let fov = 34;

  if (phase === "approach") {
    target = liveTarget;
    radius = lerp(6.4, 3.8, progress);
    height = lerp(2.7, 1.7, progress);
    angle = lerp(-0.95, -0.56, progress);
    fov = lerp(38, 31, progress);
  } else if (phase === "backswing") {
    target = torsoFocus(clip, shotFrame).add(new THREE.Vector3(0, 0.08, 0));
    radius = 4.3;
    height = lerp(2.3, 2.0, progress);
    angle = lerp(-0.82, 0.1, progress);
    fov = 30;
  } else if (phase === "contact") {
    target = contactTarget;
    radius = lerp(4.05, 3.15, progress);
    height = lerp(1.95, 1.55, progress);
    angle = lerp(-0.58, -0.45, progress);
    fov = 29;
  } else if (phase === "follow") {
    target = torsoFocus(clip, shotFrame).lerp(contactTarget, 0.18).add(new THREE.Vector3(0, 0.12, 0));
    radius = lerp(3.9, 4.9, progress);
    height = lerp(1.9, 2.35, progress);
    angle = lerp(-0.44, -0.08, progress);
    fov = lerp(29, 33, progress);
  } else {
    target = contactTarget.clone().lerp(liveTarget, lerp(0.22, 0.46, progress)).add(new THREE.Vector3(0, 0.28, 0));
    radius = lerp(6.4, 8.8, progress);
    height = lerp(2.85, 4.0, progress);
    angle = lerp(-0.24, 0.18, progress);
    fov = lerp(37, 42, progress);
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
};

const contactFocus = (clip: Clip, frame: ShotFrame) => {
  const shooter = shooterForFrame(clip, frame);
  const ball = frame.ball?.position ? toThree(frame.ball.position) : null;
  const strike = shooter ? strikeFootPoint(clip, shooter) : null;
  const pelvis = shooter?.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
  if (ball && strike) return ball.clone().lerp(strike, 0.45).add(new THREE.Vector3(0, 0.2, 0));
  if (ball && pelvis) return ball.clone().lerp(pelvis, 0.4).add(new THREE.Vector3(0, 0.3, 0));
  return ball || pelvis || new THREE.Vector3(0, 1, 0);
};

const torsoFocus = (clip: Clip, frame: ShotFrame) => {
  const shooter = shooterForFrame(clip, frame);
  const neck = shooter?.parts.neck ? toThree(shooter.parts.neck) : null;
  const pelvis = shooter?.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
  if (neck && pelvis) return neck.clone().lerp(pelvis, 0.46);
  return contactFocus(clip, frame);
};

const shooterForFrame = (clip: Clip, frame: ShotFrame) => {
  return (frame.players || []).find((player) => player.name === clip.shot.player);
};

const nearestFrame = (clip: Clip, frameNumber: number) => {
  return clip.frames.reduce(
    (best, frame) => (Math.abs(frame.frameNumber - frameNumber) < Math.abs(best.frameNumber - frameNumber) ? frame : best),
    clip.frames[0],
  );
};

const interpolatedFrame = (clip: Clip, frameNumber: number): ShotFrame => {
  const previous = clip.frames.reduce(
    (best, frame) => (frame.frameNumber <= frameNumber && frame.frameNumber > best.frameNumber ? frame : best),
    clip.frames[0],
  );
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
const directionFromPoints = (points: THREE.Vector3[]) => {
  if (points.length < 2) return new THREE.Vector3(1, 0, 0);
  const direction = points[points.length - 1].clone().sub(points[points.length - 2]);
  return direction.length() > 0.001 ? direction.normalize() : new THREE.Vector3(1, 0, 0);
};
const axisAngle = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.z - a.z, b.x - a.x);
const shortestAngleDelta = (from: number, to: number) => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};
const coachPhaseProgress = (localFrame: number) =>
  interpolate(localFrame, [0, COACH_PHASE_FRAMES - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.67, 1),
  });
const coachPhaseDataProgress = (localFrame: number) =>
  interpolate(localFrame, [0, COACH_PHASE_FRAMES - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
const phaseProgress = (localFrame: number) =>
  interpolate(localFrame, [0, PHASE_FRAMES - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.67, 1),
  });
const phaseDataProgress = (localFrame: number) =>
  interpolate(localFrame, [0, PHASE_FRAMES - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
const overlayDetail = (clip: Clip, phase: PhaseId) => {
  if (phase === "approach") return `Speed arrow: ${formatVelocity(numberValue(clip.features.foot_velocity_into_ball_m_s))}`;
  if (phase === "backswing") return `Animated arc: ${formatDegrees(numberValue(clip.features.peak_shoulder_hip_separation_deg))} peak separation`;
  if (phase === "contact") return `Measured spacing: ${formatDistance(numberValue(clip.features.min_foot_ball_distance_m))} foot-ball, ${formatSignedDistance(numberValue(clip.features.plant_foot_lateral_offset_m))} plant`;
  if (phase === "follow") return `Continuation score: ${formatScore(numberValue(clip.score.P5_score))}`;
  return `Exit: ${formatVelocity(numberValue(clip.features.ball_exit_speed_m_s))} at ${formatDegrees(numberValue(clip.features.launch_angle_deg))}`;
};
const coachPhaseScore = (clip: Clip, phase: CoachPhaseId) => {
  const key: Record<CoachPhaseId, string> = {
    context: "P1_score",
    approach: "P2_score",
    backswing: "P3_score",
    contact: "P4_score",
    follow: "P5_score",
    output: "P6_score",
  };
  return numberValue(clip.score[key[phase]] ?? clip.features[key[phase]]);
};
const phaseScore = (clip: Clip, phase: PhaseId) => {
  const key: Record<PhaseId, string> = {
    approach: "P2_score",
    backswing: "P3_score",
    contact: "P4_score",
    follow: "P5_score",
    output: "P6_score",
  };
  return numberValue(clip.score[key[phase]]);
};
const lerpVec = (a: Vec3, b: Vec3, amount: number): Vec3 => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
  z: lerp(a.z, b.z, amount),
});
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const numberValue = (value: string | number | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : Number.NaN;
};
const shotDirectionVector = (clip: Clip) => {
  const x = numberValue(clip.features.shot_direction_x);
  const y = numberValue(clip.features.shot_direction_y);
  const direction = new THREE.Vector3(Number.isNaN(x) ? 1 : x, 0, Number.isNaN(y) ? 0 : -y);
  return direction.length() > 0.001 ? direction.normalize() : new THREE.Vector3(1, 0, 0);
};
const footTrajectoryDirection = (clip: Clip, startFrame: number, endFrame: number, part: string) => {
  const start = interpolatedFrame(clip, startFrame);
  const end = interpolatedFrame(clip, endFrame);
  const startPoint = shooterForFrame(clip, start)?.parts[part];
  const endPoint = shooterForFrame(clip, end)?.parts[part];
  if (!startPoint || !endPoint) return shotDirectionVector(clip);
  const direction = toThree(endPoint).sub(toThree(startPoint));
  direction.y = 0;
  return direction.length() > 0.001 ? direction.normalize() : shotDirectionVector(clip);
};
const coachPhaseCopy = (clip: Clip, phase: CoachPhaseId) => {
  const xg = numberValue(clip.score.xG);
  const pressure = clip.score.pressure ?? clip.features.pressure ?? "low";
  const approachSpeed = numberValue(clip.features.approach_speed_m_s);
  const approachAngle = numberValue(clip.features.approach_angle_deg);
  const trunkLean = numberValue(clip.features.trunk_lean_approach_deg);
  const separation = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  const plantForward = numberValue(clip.features.plant_foot_forward_offset_m);
  const plantLateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  const footGap = numberValue(clip.features.min_foot_ball_distance_m);
  const footVelocity = numberValue(clip.features.foot_velocity_into_ball_m_s);
  const ratio = numberValue(clip.features.ball_to_foot_speed_ratio);
  const follow = numberValue(clip.features.com_continuation_score);
  const exit = numberValue(clip.features.ball_exit_speed_m_s);
  const launch = numberValue(clip.features.launch_angle_deg);

  if (phase === "context") {
    return {
      kicker: "P1 · why this shot needs mechanics",
      headline: "Low-probability context means the technique has to create the threat.",
      subhead: "The shot is self-created, so the body mechanics carry more of the burden than the chance quality.",
      measured: `${Number.isNaN(xg) ? "xG -" : `xG ${xg.toFixed(3)}`} · pressure ${String(pressure).replace(/_/g, " ")} · family ${String(clip.features.family || clip.score.family || "shot").replace(/_/g, " ")}`,
      visual: "The full local frame stays wide: shooter, opponents, ball lane, and target direction are visible before the zoom begins.",
      why: "P1 sets the difficulty. A modest chance can still produce a dangerous output if P2-P4 create clean speed and contact.",
      scoreHelper: "context quality",
      values: [
        {label: "xG", value: Number.isNaN(xg) ? "-" : xg.toFixed(3), helper: "chance value"},
        {label: "Family", value: String(clip.features.family || clip.score.family || "shot").replace(/_/g, " "), helper: "shot type"},
      ],
    };
  }
  if (phase === "approach") {
    return {
      kicker: "P2 · approach and runway",
      headline: "The run-up builds speed without forcing the final touch.",
      subhead: "We show the foot path into the ball and the angle between the approach vector and shot line.",
      measured: `${formatVelocity(approachSpeed)} approach speed · ${formatDegrees(approachAngle)} approach angle · ${formatDegrees(trunkLean)} trunk lean`,
      visual: "Purple runway arrow = strike-foot approach. Cyan/blue lane = ball-to-target line. The arc shows the approach angle.",
      why: "A controlled 21-degree entry lets the plant happen beside the ball while the strike foot keeps accelerating late.",
      scoreHelper: "run-up quality",
      values: [
        {label: "Speed", value: formatVelocity(approachSpeed), helper: "approach"},
        {label: "Angle", value: formatDegrees(approachAngle), helper: "to shot line"},
      ],
    };
  }
  if (phase === "backswing") {
    return {
      kicker: "P3 · backswing and plant",
      headline: "The hips lead, the shoulders delay, and the plant sets the brace.",
      subhead: "This is the coil phase: useful separation only matters if the plant base can absorb it.",
      measured: `${formatDegrees(separation)} hip-shoulder separation · plant ${formatSignedDistance(plantForward)} forward, ${formatSignedDistance(plantLateral)} lateral`,
      visual: "Green line = hip axis. Blue line = shoulder axis. The arc measures their separation while the ruler shows plant-to-ball base.",
      why: "Separation stores rotational energy; the plant distance gives the body a stable post to unwind through contact.",
      scoreHelper: "loading phase",
      values: [
        {label: "Separation", value: formatDegrees(separation), helper: "X-factor"},
        {label: "Plant base", value: formatDistance(Math.abs(plantLateral)), helper: "lateral brace"},
      ],
    };
  }
  if (phase === "contact") {
    return {
      kicker: "P4 · impact transfer",
      headline: "The best part of this shot is the compact contact frame.",
      subhead: "We freeze contact, measure the foot-ball gap, then reveal how foot speed becomes ball speed.",
      measured: `${formatDistance(footGap)} foot-ball gap · ${formatVelocity(footVelocity)} foot velocity · ${formatRatio(ratio)} ball/foot ratio`,
      visual: "Cyan ruler = actual toe-to-ball gap. Blue base = plant-to-ball spacing. Purple and blue arrows compare foot and ball velocity.",
      why: "The 0.10m gap keeps contact close to the rigid part of the foot, while a braced plant helps convert swing speed into exit speed.",
      scoreHelper: "highest weight",
      values: [
        {label: "Gap", value: formatDistance(footGap), helper: "toe to ball"},
        {label: "Transfer", value: formatRatio(ratio), helper: "ball / foot"},
      ],
    };
  }
  if (phase === "follow") {
    return {
      kicker: "P5 · follow-through",
      headline: "The body keeps moving through the ball instead of stopping at impact.",
      subhead: "Post-contact trails show whether the pelvis and strike foot continue in the shot direction.",
      measured: `COM continuation ${Number.isNaN(follow) ? "-" : `${Math.round(follow * 100)}%`} · P5 ${formatScore(numberValue(clip.score.P5_score))}`,
      visual: "The pelvis path and strike-foot path are drawn after contact, so the shot can be judged beyond the frozen frame.",
      why: "Continuation makes the strike repeatable. When the body stalls early, power can remain but placement control usually drops.",
      scoreHelper: "continuity",
      values: [
        {label: "COM", value: Number.isNaN(follow) ? "-" : `${Math.round(follow * 100)}%`, helper: "continues"},
        {label: "P5", value: formatScore(numberValue(clip.score.P5_score)), helper: "phase score"},
      ],
    };
  }
  return {
    kicker: "P6 · output audit",
    headline: "The ball flight tells us what the mechanics became.",
    subhead: "This phase checks speed, launch, and whether the release converts clean contact into useful placement.",
    measured: `${formatVelocity(exit)} exit speed · ${formatDegrees(launch)} launch angle · result ${String(clip.score.shot_result || "shot").replace(/_/g, " ")}`,
    visual: "The ball path grows from contact, the velocity arrow shows release direction, and the small arc shows launch angle.",
    why: "The mechanics produced elite speed; P6 explains the remaining tradeoff between power, launch, and final placement.",
    scoreHelper: "result phase",
    values: [
      {label: "Exit", value: formatVelocity(exit), helper: "ball speed"},
      {label: "Launch", value: formatDegrees(launch), helper: "vertical"},
    ],
  };
};
const stickerPhaseCopy = (clip: Clip, phase: CoachPhaseId) => {
  const phaseScoreValue = formatScore(coachPhaseScore(clip, phase));
  const approachSpeed = numberValue(clip.features.approach_speed_m_s);
  const approachAngle = numberValue(clip.features.approach_angle_deg);
  const separation = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  const plantLateral = numberValue(clip.features.plant_foot_lateral_offset_m);
  const footGap = numberValue(clip.features.min_foot_ball_distance_m);
  const footVelocity = numberValue(clip.features.foot_velocity_into_ball_m_s);
  const ratio = numberValue(clip.features.ball_to_foot_speed_ratio);
  const follow = numberValue(clip.features.com_continuation_score);
  const exit = numberValue(clip.features.ball_exit_speed_m_s);
  const launch = numberValue(clip.features.launch_angle_deg);

  if (phase === "context") {
    return {
      kicker: "P1 · shot picture",
      title: "Show the lane before the mechanics zoom in.",
      text: "The first sticker pass keeps the shooter, ball, and shot lane readable without turning the frame into a dashboard.",
      stickers: [
        {label: "phase", value: `${phaseScoreValue} context`, color: MEASURE_CYAN, x: 220, y: 770},
        {label: "lane", value: "target line", color: BALL_BLUE, x: 880, y: 455},
      ],
    };
  }
  if (phase === "approach") {
    return {
      kicker: "P2 · approach runway",
      title: "The run-up is a measured path, not a label.",
      text: "A purple trail follows the strike foot, while the blue shot lane gives the approach angle something to compare against.",
      stickers: [
        {label: "speed", value: formatVelocity(approachSpeed), color: FOOT_VIOLET, x: 500, y: 725},
        {label: "angle", value: formatDegrees(approachAngle), color: MEASURE_CYAN, x: 810, y: 590},
        {label: "phase", value: `${phaseScoreValue} run-up`, color: BALL_BLUE, x: 1110, y: 770},
      ],
    };
  }
  if (phase === "backswing") {
    return {
      kicker: "P3 · backswing coil",
      title: "X-factor arc shows hip–shoulder separation in the load window.",
      text: "Thin projected axes and a planar arc match the scored peak coil; plant-to-ball distance anchors the base on the turf.",
      stickers: [
        {label: "phase", value: `${phaseScoreValue} load`, color: HIP_GREEN, x: 340, y: 800},
      ],
    };
  }
  if (phase === "contact") {
    return {
      kicker: "P4 · contact transfer",
      title: "Freeze contact and draw the evidence directly on it.",
      text: "The gap ruler, plant-base bracket, and paired velocity arrows explain why this impact phase carries the biggest weight.",
      stickers: [
        {label: "gap", value: formatDistance(footGap), color: MEASURE_CYAN, x: 830, y: 680},
        {label: "foot speed", value: formatVelocity(footVelocity), color: FOOT_VIOLET, x: 500, y: 445},
        {label: "transfer", value: formatRatio(ratio), color: BALL_BLUE, x: 1180, y: 535},
      ],
    };
  }
  if (phase === "follow") {
    return {
      kicker: "P5 · follow-through",
      title: "The trails show whether the shot continues.",
      text: "The pelvis and strike-foot trails stay on screen so the viewer sees continuity after the frozen contact frame.",
      stickers: [
        {label: "COM", value: Number.isNaN(follow) ? "-" : `${Math.round(follow * 100)}%`, color: MEASURE_CYAN, x: 545, y: 640},
        {label: "phase", value: `${phaseScoreValue} follow`, color: FOOT_VIOLET, x: 1060, y: 730},
      ],
    };
  }
  return {
    kicker: "P6 · output",
    title: "The ball path audits the mechanics.",
    text: "The final stickers show speed and launch without hiding the actual flight line from the contact frame.",
    stickers: [
      {label: "exit speed", value: formatVelocity(exit), color: BALL_BLUE, x: 1120, y: 480},
      {label: "launch", value: formatDegrees(launch), color: MEASURE_CYAN, x: 930, y: 355},
      {label: "phase", value: `${phaseScoreValue} output`, color: SUBJECT_WHITE, x: 360, y: 780},
    ],
  };
};
const stickerGeometry = (
  clip: Clip,
  shotFrame: ShotFrame,
  contactFrame: ShotFrame,
  phase: CoachPhaseId,
  camera: {position: THREE.Vector3; target: THREE.Vector3; fov: number},
  width: number,
  height: number,
): StickerGeometry => {
  const frameForBody = phase === "contact" || phase === "backswing" ? contactFrame : shotFrame;
  const shooter = shooterForFrame(clip, frameForBody);
  const contactShooter = shooterForFrame(clip, contactFrame) || shooter;
  const ball3 = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : undefined;
  const contactBall3 = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : ball3;
  const strikeFoot3 = shooter ? strikeFootPoint(clip, shooter) || undefined : undefined;
  const contactStrikeFoot3 = contactShooter ? strikeFootPoint(clip, contactShooter) || strikeFoot3 : strikeFoot3;
  const plantFoot3 = contactShooter ? plantFootPoint(clip, contactShooter) || undefined : undefined;
  const pelvis3 = shooter?.parts.pelvis ? toThree(shooter.parts.pelvis) : undefined;
  const shotDir = shotDirectionVector(clip);
  const shotEnd3 = (contactBall3 || ball3)?.clone().add(shotDir.multiplyScalar(4.2));
  const strikeFootBack3 = contactStrikeFoot3?.clone().sub(footTrajectoryDirection(clip, contactNumber(clip) - 5, contactNumber(clip), `${String(clip.features.inferred_foot || "right")}_toe`).multiplyScalar(1.5));

  const project = (point?: THREE.Vector3) => (point ? projectToScreen(point, camera, width, height) : undefined);
  const leftHip3 = contactShooter?.parts.left_hip ? toThree(contactShooter.parts.left_hip) : undefined;
  const rightHip3 = contactShooter?.parts.right_hip ? toThree(contactShooter.parts.right_hip) : undefined;
  const leftShoulder3 = contactShooter?.parts.left_shoulder ? toThree(contactShooter.parts.left_shoulder) : undefined;
  const rightShoulder3 = contactShooter?.parts.right_shoulder ? toThree(contactShooter.parts.right_shoulder) : undefined;

  const contact = contactNumber(clip);
  const strikePart = `${String(clip.features.inferred_foot || "right")}_toe`;
  const footPathFrames =
    phase === "follow"
      ? clip.frames.filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= Math.min(clip.frameWindow.end, contact + 28))
      : clip.frames.filter((frame) => frame.frameNumber >= contact - 38 && frame.frameNumber <= contact);
  const footPath = footPathFrames
    .map((frame) => shooterForFrame(clip, frame)?.parts[strikePart])
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => project(toThree(point)))
    .filter((point): point is ScreenPoint => Boolean(point));
  const pelvisPath = clip.frames
    .filter((frame) => frame.frameNumber >= contact && frame.frameNumber <= Math.min(clip.frameWindow.end, contact + 28))
    .map((frame) => shooterForFrame(clip, frame)?.parts.pelvis)
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => project(toThree(point)))
    .filter((point): point is ScreenPoint => Boolean(point));
  const ballPath = clip.frames
    .filter((frame) => frame.frameNumber >= contact)
    .map((frame) => frame.ball?.position)
    .filter((point): point is Vec3 => Boolean(point))
    .map((point) => project(toThree(point)))
    .filter((point): point is ScreenPoint => Boolean(point));

  return {
    shooter: project(pelvis3),
    ball: project(contactBall3 || ball3),
    shotEnd: project(shotEnd3),
    strikeFoot: project(contactStrikeFoot3 || strikeFoot3),
    strikeFootBack: project(strikeFootBack3),
    plantFoot: project(plantFoot3),
    pelvis: project(pelvis3),
    leftHip: project(leftHip3),
    rightHip: project(rightHip3),
    leftShoulder: project(leftShoulder3),
    rightShoulder: project(rightShoulder3),
    footPath,
    pelvisPath,
    ballPath,
    angleArc: stickerAngleArc(phase, clip, contactShooter, contactBall3 || ball3, camera, width, height),
  };
};
const stickerAngleArc = (
  phase: CoachPhaseId,
  clip: Clip,
  player: Player | undefined,
  ball: THREE.Vector3 | undefined,
  camera: {position: THREE.Vector3; target: THREE.Vector3; fov: number},
  width: number,
  height: number,
) => {
  if (phase === "backswing" && player?.parts.left_hip && player.parts.right_hip && player.parts.left_shoulder && player.parts.right_shoulder && player.parts.pelvis) {
    const center = toThree(player.parts.pelvis).add(new THREE.Vector3(0, 0.74, 0));
    const hipAngle = axisAngle(toThree(player.parts.left_hip), toThree(player.parts.right_hip));
    const shoulderAngle = axisAngle(toThree(player.parts.left_shoulder), toThree(player.parts.right_shoulder));
    return worldArcPoints(center, hipAngle, shoulderAngle, 0.78).map((point) => projectToScreen(point, camera, width, height));
  }
  if ((phase === "approach" || phase === "context") && ball) {
    const contact = contactNumber(clip);
    const approachDir = footTrajectoryDirection(clip, contact - 34, contact, `${String(clip.features.inferred_foot || "right")}_toe`);
    const shotDir = shotDirectionVector(clip);
    return worldArcPoints(ball.clone().add(new THREE.Vector3(0, 0.22, 0)), Math.atan2(approachDir.z, approachDir.x), Math.atan2(shotDir.z, shotDir.x), 0.76).map((point) => projectToScreen(point, camera, width, height));
  }
  if (phase === "output" && ball) {
    const launch = THREE.MathUtils.degToRad(numberValue(clip.features.launch_angle_deg) || 0);
    const shotDir = shotDirectionVector(clip);
    return Array.from({length: 28}, (_, index) => {
      const amount = index / 27;
      return ball
        .clone()
        .add(shotDir.clone().multiplyScalar(Math.cos(launch * amount) * 1.05))
        .add(new THREE.Vector3(0, Math.sin(launch * amount) * 1.05 + 0.16, 0));
    }).map((point) => projectToScreen(point, camera, width, height));
  }
  return [];
};
const worldArcPoints = (center: THREE.Vector3, fromAngle: number, toAngle: number, radius: number) => {
  const delta = shortestAngleDelta(fromAngle, toAngle);
  return Array.from({length: 32}, (_, index) => {
    const amount = index / 31;
    const angle = fromAngle + delta * amount;
    return new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius);
  });
};
const projectToScreen = (
  point: THREE.Vector3,
  cameraConfig: {position: THREE.Vector3; target: THREE.Vector3; fov: number},
  width: number,
  height: number,
): ScreenPoint => {
  const camera = new THREE.PerspectiveCamera(cameraConfig.fov, width / height, 0.1, 1000);
  camera.position.copy(cameraConfig.position);
  camera.lookAt(cameraConfig.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const vector = point.clone().project(camera);
  return {
    x: (vector.x * 0.5 + 0.5) * width,
    y: (-vector.y * 0.5 + 0.5) * height,
  };
};
const lerpPoint = (a: ScreenPoint, b: ScreenPoint, amount: number): ScreenPoint => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
});
const transparentize = (color: string, alpha: number) => {
  const parsed = new THREE.Color(color);
  return `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${alpha})`;
};
const formatScore = (value: number) => (Number.isNaN(value) ? "-" : String(Math.round(value)));
const formatDistance = (value: number) => (Number.isNaN(value) ? "-" : `${Math.abs(value).toFixed(2)}m`);
const formatSignedDistance = (value: number) => (Number.isNaN(value) ? "-" : `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}m`);
const formatVelocity = (value: number) => (Number.isNaN(value) ? "-" : `${value.toFixed(1)} m/s`);
const formatDegrees = (value: number) => (Number.isNaN(value) ? "-" : `${value.toFixed(1)} deg`);
const formatRatio = (value: number) => (Number.isNaN(value) ? "-" : `${value.toFixed(2)}x`);

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: DARK,
    color: ICE,
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },
  blueGrade: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(2,8,20,0.1) 0%, rgba(4,14,34,0.1) 46%, rgba(1,4,12,0.8) 100%), radial-gradient(ellipse at 62% 20%, rgba(30,231,255,0.16), rgba(30,231,255,0) 32%)",
    pointerEvents: "none",
  },
  vignette: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(ellipse at 50% 48%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 58%, rgba(0,0,0,0.82) 100%)",
    pointerEvents: "none",
  },
  phaseHeader: {
    position: "absolute",
    left: 58,
    top: 48,
    width: 850,
  },
  kicker: {
    color: MUTED_ICE,
    fontSize: 19,
    fontWeight: 800,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 7,
    fontSize: 52,
    lineHeight: 1.02,
    fontWeight: 920,
    letterSpacing: 0,
    textShadow: "0 8px 28px rgba(0,0,0,0.65)",
  },
  meta: {
    marginTop: 11,
    fontSize: 22,
    lineHeight: 1.2,
    color: "rgba(233,251,255,0.68)",
    fontWeight: 650,
  },
  phaseChip: {
    position: "absolute",
    right: 58,
    top: 54,
    minWidth: 292,
    padding: "18px 22px",
    background: PANEL,
    border: "1px solid rgba(30,231,255,0.34)",
    borderRadius: 8,
    boxShadow: "0 16px 44px rgba(0,0,0,0.34), inset 0 0 28px rgba(30,231,255,0.08)",
  },
  phaseCode: {
    display: "block",
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 920,
  },
  phaseShort: {
    display: "block",
    marginTop: 8,
    color: ELECTRIC,
    fontSize: 18,
    fontWeight: 850,
    textTransform: "uppercase",
  },
  chapterRail: {
    position: "absolute",
    left: 58,
    right: 58,
    bottom: 46,
    height: 58,
  },
  chapterFill: {
    position: "absolute",
    left: 0,
    top: 11,
    height: 3,
    background: `linear-gradient(90deg, ${ELECTRIC}, ${VIOLET})`,
    boxShadow: "0 0 24px rgba(30,231,255,0.68)",
  },
  chapterItem: {
    position: "relative",
    display: "inline-block",
    width: "20%",
    height: 58,
    zIndex: 2,
  },
  chapterDot: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: "2px solid rgba(207,238,255,0.24)",
  },
  chapterLabel: {
    whiteSpace: "pre-line",
    marginTop: 8,
    fontSize: 16,
    lineHeight: 1.05,
    fontWeight: 780,
  },
  readoutPanel: {
    position: "absolute",
    left: 58,
    bottom: 132,
    width: 610,
    padding: "24px 26px",
    border: "1px solid rgba(30,231,255,0.25)",
    borderRadius: 8,
    background: "rgba(2,10,22,0.58)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.42)",
  },
  readoutEyebrow: {
    color: ICE,
    fontSize: 29,
    lineHeight: 1.08,
    fontWeight: 900,
    letterSpacing: 0,
  },
  readoutText: {
    marginTop: 10,
    fontSize: 21,
    lineHeight: 1.28,
    color: "rgba(233,251,255,0.74)",
    fontWeight: 650,
  },
  readoutMetric: {
    marginTop: 16,
    color: ELECTRIC,
    fontSize: 20,
    lineHeight: 1.2,
    fontWeight: 850,
  },
  metricStack: {
    position: "absolute",
    right: 58,
    bottom: 132,
    width: 300,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  metricCell: {
    padding: "15px 17px",
    background: "rgba(1, 9, 20, 0.7)",
    border: "1px solid rgba(121,184,255,0.26)",
    borderRadius: 8,
    boxShadow: "inset 0 0 22px rgba(20,109,255,0.08)",
  },
  metricLabel: {
    color: "rgba(233,251,255,0.58)",
    fontSize: 15,
    fontWeight: 820,
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: 6,
    color: ICE,
    fontSize: 32,
    lineHeight: 1,
    fontWeight: 930,
  },
  splitShade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 560,
    background: "linear-gradient(90deg, rgba(2,7,18,0), rgba(2,9,24,0.86) 18%, rgba(2,9,24,0.96))",
    pointerEvents: "none",
  },
  splitTitle: {
    position: "absolute",
    left: 54,
    top: 46,
    color: ICE,
  },
  splitPanel: {
    position: "absolute",
    right: 42,
    top: 92,
    width: 480,
    padding: "25px 27px",
    border: "1px solid rgba(30,231,255,0.32)",
    borderRadius: 8,
    background: "rgba(3,13,30,0.82)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.48), inset 0 0 36px rgba(30,231,255,0.07)",
  },
  splitPanelKicker: {
    color: ELECTRIC,
    fontSize: 16,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  splitPanelTitle: {
    marginTop: 10,
    color: ICE,
    fontSize: 33,
    lineHeight: 1.05,
    fontWeight: 920,
  },
  splitPanelMetric: {
    marginTop: 16,
    color: PLANT_BLUE,
    fontSize: 24,
    lineHeight: 1.18,
    fontWeight: 900,
  },
  splitPanelSection: {
    marginTop: 22,
    color: "rgba(233,251,255,0.52)",
    fontSize: 14,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  splitPanelText: {
    marginTop: 7,
    color: "rgba(233,251,255,0.78)",
    fontSize: 20,
    lineHeight: 1.24,
    fontWeight: 650,
  },
  splitRail: {
    position: "absolute",
    left: 54,
    right: 600,
    bottom: 52,
    height: 48,
  },
  splitRailItem: {
    position: "relative",
    display: "inline-block",
    width: "20%",
    height: 48,
    zIndex: 2,
  },
  splitRailDot: {
    width: 19,
    height: 19,
    borderRadius: 999,
    border: "2px solid rgba(207,238,255,0.24)",
  },
  splitRailLabel: {
    marginTop: 7,
    color: "rgba(233,251,255,0.72)",
    fontSize: 14,
    fontWeight: 850,
  },
  splitRailFill: {
    position: "absolute",
    left: 0,
    top: 9,
    height: 3,
    background: `linear-gradient(90deg, ${ELECTRIC}, ${PLANT_BLUE})`,
    boxShadow: "0 0 22px rgba(30,231,255,0.55)",
  },
  broadcastTopline: {
    position: "absolute",
    left: 58,
    top: 44,
    display: "flex",
    alignItems: "center",
    gap: 14,
    color: "rgba(233,251,255,0.76)",
    fontSize: 19,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  broadcastLeague: {
    color: ELECTRIC,
  },
  broadcastDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: PLANT_BLUE,
    boxShadow: "0 0 14px rgba(30,231,255,0.8)",
  },
  broadcastHero: {
    position: "absolute",
    left: 58,
    bottom: 118,
    width: 890,
    color: ICE,
    textShadow: "0 8px 28px rgba(0,0,0,0.72)",
  },
  broadcastPhase: {
    color: ELECTRIC,
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 950,
    textTransform: "uppercase",
  },
  broadcastHeadline: {
    marginTop: 12,
    fontSize: 70,
    lineHeight: 0.98,
    fontWeight: 950,
    letterSpacing: 0,
  },
  broadcastSub: {
    marginTop: 18,
    width: 760,
    color: "rgba(233,251,255,0.76)",
    fontSize: 25,
    lineHeight: 1.2,
    fontWeight: 760,
  },
  broadcastMeasure: {
    position: "absolute",
    right: 54,
    top: 52,
    minWidth: 365,
    padding: "18px 22px",
    border: "1px solid rgba(233,251,255,0.3)",
    borderRadius: 6,
    background: "rgba(2,9,22,0.64)",
  },
  broadcastMeasureLabel: {
    color: "rgba(233,251,255,0.58)",
    fontSize: 15,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  broadcastMeasureValue: {
    marginTop: 7,
    color: ICE,
    fontSize: 27,
    fontWeight: 930,
  },
  broadcastRail: {
    position: "absolute",
    left: 58,
    right: 58,
    bottom: 42,
    height: 38,
  },
  broadcastRailItem: {
    position: "relative",
    display: "inline-block",
    width: "20%",
    height: 38,
    zIndex: 2,
  },
  broadcastRailDot: {
    width: 15,
    height: 15,
    borderRadius: 999,
    border: "2px solid rgba(207,238,255,0.24)",
  },
  broadcastRailLabel: {
    marginTop: 6,
    color: "rgba(233,251,255,0.72)",
    fontSize: 13,
    fontWeight: 900,
  },
  broadcastRailFill: {
    position: "absolute",
    left: 0,
    top: 7,
    height: 2,
    background: `linear-gradient(90deg, ${ELECTRIC}, ${PLANT_BLUE})`,
  },
  diagnosticHeader: {
    position: "absolute",
    left: 50,
    top: 42,
    color: ICE,
  },
  diagnosticPanel: {
    position: "absolute",
    right: 42,
    top: 42,
    bottom: 42,
    width: 520,
    padding: "24px 26px",
    border: "1px solid rgba(30,231,255,0.3)",
    borderRadius: 8,
    background: "rgba(2,10,23,0.84)",
    boxShadow: "0 22px 70px rgba(0,0,0,0.5), inset 0 0 34px rgba(30,231,255,0.07)",
  },
  diagnosticPhaseGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
  },
  diagnosticPhaseCell: {
    padding: "12px 8px",
    border: "1px solid rgba(125,190,255,0.18)",
    borderRadius: 6,
    textAlign: "center",
  },
  diagnosticPhaseCode: {
    color: "rgba(233,251,255,0.62)",
    fontSize: 14,
    fontWeight: 900,
  },
  diagnosticPhaseScore: {
    marginTop: 5,
    color: ICE,
    fontSize: 24,
    fontWeight: 930,
  },
  diagnosticMeasured: {
    marginTop: 25,
    color: "rgba(233,251,255,0.62)",
    fontSize: 15,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  diagnosticValue: {
    marginTop: 8,
    color: ELECTRIC,
    fontSize: 31,
    lineHeight: 1.08,
    fontWeight: 930,
  },
  diagnosticText: {
    marginTop: 18,
    color: "rgba(233,251,255,0.78)",
    fontSize: 19,
    lineHeight: 1.26,
    fontWeight: 630,
  },
  metricBarRow: {
    display: "grid",
    gridTemplateColumns: "130px 1fr 44px",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
  },
  metricBarLabel: {
    color: "rgba(233,251,255,0.64)",
    fontSize: 14,
    fontWeight: 850,
  },
  metricBarTrack: {
    height: 9,
    borderRadius: 999,
    background: "rgba(233,251,255,0.13)",
    overflow: "hidden",
  },
  metricBarFill: {
    height: "100%",
    borderRadius: 999,
    boxShadow: "0 0 18px rgba(30,231,255,0.42)",
  },
  metricBarValue: {
    color: ICE,
    fontSize: 18,
    fontWeight: 900,
    textAlign: "right",
  },
  coachBlueGrade: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(2,8,20,0.06) 0%, rgba(4,14,34,0.12) 46%, rgba(1,4,12,0.82) 100%), radial-gradient(ellipse at 56% 22%, rgba(58,134,255,0.18), rgba(58,134,255,0) 34%)",
    pointerEvents: "none",
  },
  coachHeader: {
    position: "absolute",
    left: 56,
    top: 42,
    width: 820,
  },
  coachPhaseBadge: {
    position: "absolute",
    right: 52,
    top: 44,
    width: 330,
    padding: "17px 20px",
    border: "1px solid rgba(94,231,255,0.34)",
    borderRadius: 8,
    background: "rgba(2, 10, 24, 0.72)",
    boxShadow: "0 18px 54px rgba(0,0,0,0.38), inset 0 0 26px rgba(58,134,255,0.08)",
  },
  coachPhaseCode: {
    color: MEASURE_CYAN,
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 950,
    textTransform: "uppercase",
  },
  coachPhaseName: {
    marginTop: 8,
    color: ICE,
    fontSize: 28,
    lineHeight: 1,
    fontWeight: 930,
  },
  coachPhaseFeature: {
    marginTop: 8,
    color: "rgba(233,251,255,0.62)",
    fontSize: 15,
    lineHeight: 1.16,
    fontWeight: 760,
    textTransform: "uppercase",
  },
  coachExplanationPanel: {
    position: "absolute",
    right: 52,
    top: 170,
    width: 560,
    padding: "24px 26px",
    border: "1px solid rgba(145,184,215,0.24)",
    borderRadius: 8,
    background: "rgba(2, 10, 24, 0.78)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.46), inset 0 0 34px rgba(58,134,255,0.06)",
  },
  coachPanelKicker: {
    color: MEASURE_CYAN,
    fontSize: 16,
    lineHeight: 1,
    fontWeight: 920,
    textTransform: "uppercase",
  },
  coachPanelTitle: {
    marginTop: 11,
    color: ICE,
    fontSize: 33,
    lineHeight: 1.05,
    fontWeight: 940,
    letterSpacing: 0,
  },
  coachPanelSub: {
    marginTop: 12,
    color: "rgba(233,251,255,0.74)",
    fontSize: 18,
    lineHeight: 1.26,
    fontWeight: 650,
  },
  coachRows: {
    marginTop: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  coachInsightRow: {
    display: "grid",
    gridTemplateColumns: "112px 1fr",
    gap: 16,
    alignItems: "start",
  },
  coachInsightLabel: {
    color: "rgba(233,251,255,0.48)",
    fontSize: 13,
    lineHeight: 1.15,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  coachInsightText: {
    color: "rgba(233,251,255,0.82)",
    fontSize: 17,
    lineHeight: 1.24,
    fontWeight: 670,
  },
  coachMetricShelf: {
    position: "absolute",
    left: 54,
    right: 54,
    bottom: 108,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 12,
  },
  coachValueCard: {
    minHeight: 94,
    padding: "16px 17px",
    border: "1px solid rgba(145,184,215,0.24)",
    borderRadius: 8,
    background: "rgba(1, 8, 20, 0.74)",
    boxShadow: "inset 0 0 22px rgba(58,134,255,0.07)",
  },
  coachValueLabel: {
    color: "rgba(233,251,255,0.55)",
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  coachValueNumber: {
    marginTop: 8,
    color: ICE,
    fontSize: 30,
    lineHeight: 1,
    fontWeight: 940,
  },
  coachValueHelper: {
    marginTop: 8,
    color: "rgba(233,251,255,0.5)",
    fontSize: 14,
    lineHeight: 1.12,
    fontWeight: 720,
  },
  coachLegend: {
    position: "absolute",
    left: 56,
    top: 168,
    display: "flex",
    flexDirection: "column",
    gap: 9,
    padding: "14px 16px",
    border: "1px solid rgba(145,184,215,0.18)",
    borderRadius: 8,
    background: "rgba(2,10,24,0.54)",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "rgba(233,251,255,0.68)",
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 760,
    textTransform: "uppercase",
  },
  legendDot: {
    width: 11,
    height: 11,
    borderRadius: 999,
  },
  coachRail: {
    position: "absolute",
    left: 56,
    right: 56,
    bottom: 40,
    height: 48,
  },
  coachRailFill: {
    position: "absolute",
    left: 0,
    top: 10,
    height: 3,
    background: `linear-gradient(90deg, ${MEASURE_CYAN}, ${SHOULDER_BLUE}, ${HIP_GREEN})`,
    boxShadow: "0 0 24px rgba(94,231,255,0.58)",
  },
  coachRailItem: {
    position: "relative",
    display: "inline-block",
    width: "16.666%",
    height: 48,
    zIndex: 2,
  },
  coachRailDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    border: "2px solid rgba(145,184,215,0.28)",
  },
  coachRailLabel: {
    marginTop: 7,
    fontSize: 15,
    lineHeight: 1,
    fontWeight: 900,
  },
  stickerBlueGrade: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(0,8,20,0.02) 0%, rgba(1,10,28,0.18) 48%, rgba(0,3,10,0.86) 100%), radial-gradient(ellipse at 50% 24%, rgba(58,134,255,0.16), rgba(58,134,255,0) 36%)",
    pointerEvents: "none",
  },
  stickerSvg: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  },
  stickerHeader: {
    position: "absolute",
    left: 52,
    top: 42,
    width: 760,
    color: ICE,
    textShadow: "0 10px 32px rgba(0,0,0,0.68)",
  },
  stickerKicker: {
    color: "rgba(233,251,255,0.68)",
    fontSize: 17,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  stickerTitle: {
    marginTop: 8,
    color: ICE,
    fontSize: 49,
    lineHeight: 1,
    fontWeight: 950,
  },
  stickerMeta: {
    marginTop: 9,
    color: "rgba(233,251,255,0.62)",
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 720,
  },
  stickerPhasePill: {
    position: "absolute",
    right: 52,
    top: 44,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "13px 18px",
    border: "2px solid rgba(94,231,255,0.58)",
    borderRadius: 999,
    background: "rgba(1,9,22,0.74)",
    boxShadow: "0 14px 40px rgba(0,0,0,0.36)",
  },
  stickerPhaseCode: {
    color: MEASURE_CYAN,
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 950,
  },
  stickerPhaseText: {
    color: ICE,
    fontSize: 21,
    lineHeight: 1,
    fontWeight: 900,
  },
  stickerStoryboard: {
    position: "absolute",
    right: 52,
    top: 112,
    width: 470,
    padding: "18px 20px",
    border: "1px solid rgba(145,184,215,0.28)",
    borderRadius: 8,
    background: "rgba(1,9,22,0.64)",
    boxShadow: "0 18px 50px rgba(0,0,0,0.36)",
  },
  stickerStoryKicker: {
    color: MEASURE_CYAN,
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  stickerStoryTitle: {
    marginTop: 9,
    color: ICE,
    fontSize: 26,
    lineHeight: 1.04,
    fontWeight: 930,
  },
  stickerStoryText: {
    marginTop: 10,
    color: "rgba(233,251,255,0.72)",
    fontSize: 16,
    lineHeight: 1.24,
    fontWeight: 650,
  },
  stickerBubble: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 142,
    maxWidth: 260,
    padding: "10px 13px",
    border: "2px solid rgba(94,231,255,0.8)",
    borderRadius: 999,
    background: "rgba(2,10,24,0.82)",
    color: ICE,
    transformOrigin: "50% 50%",
    pointerEvents: "none",
  },
  stickerBubbleDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    flex: "0 0 auto",
  },
  stickerBubbleLabel: {
    color: "rgba(233,251,255,0.58)",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  stickerBubbleValue: {
    marginTop: 4,
    color: ICE,
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 930,
    whiteSpace: "nowrap",
  },
  stickerRail: {
    position: "absolute",
    left: 52,
    right: 52,
    bottom: 40,
    height: 42,
  },
  stickerRailFill: {
    position: "absolute",
    left: 0,
    top: 9,
    height: 3,
    background: `linear-gradient(90deg, ${MEASURE_CYAN}, ${FOOT_VIOLET}, ${BALL_BLUE})`,
    boxShadow: "0 0 24px rgba(94,231,255,0.55)",
  },
  stickerRailItem: {
    position: "relative",
    display: "inline-block",
    width: "16.666%",
    height: 42,
    zIndex: 2,
  },
  stickerRailDot: {
    width: 20,
    height: 20,
    borderRadius: 999,
    border: "2px solid rgba(222,241,255,0.36)",
  },
  stickerRailLabel: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 900,
  },
  stickerTick: {
    position: "absolute",
    left: 52,
    bottom: 94,
    width: 132,
    height: 3,
    borderRadius: 999,
    background: MEASURE_CYAN,
    boxShadow: "0 0 22px rgba(94,231,255,0.72)",
  },
};
