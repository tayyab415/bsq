import {Composition} from "remotion";
import {ContactFreezePoc} from "./ContactFreezePoc";
import {ShotAnnotationLibrary, SWATCH_HEIGHT, SWATCH_WIDTH} from "./ShotAnnotationLibrary";
import {AnnotationCoachExplainer} from "./ShootingAnnotationCoachExplainer";
import {BiomechImplicationExplainer} from "./ShootingBiomechImplicationExplainer";
import {CoachTimelineExplainer} from "./ShootingCoachTimelineExplainer";
import {ClarityCoachExplainer} from "./ShootingClarityCoachExplainer";
import {CleanContactSlowMoExplainer} from "./ShootingCleanSlowMoExplainer";
import {ExtendedContactSlowMoExplainer} from "./ShootingExtendedSlowMoExplainer";
import {HudlStyleExplainer} from "./ShootingHudlStyleExplainer";
import {MeasurementFocusExplainer} from "./ShootingMeasurementFocusExplainer";
import {PhaseMechanicsBroadcastC} from "./ShootingPhaseMechanicsBroadcastC";
import {PhaseMechanicsCoachCutA2} from "./ShootingPhaseCoachCutA2";
import {PhaseMechanicsCloseupA} from "./ShootingPhaseMechanicsCloseupA";
import {PhaseMechanicsDiagnosticD} from "./ShootingPhaseMechanicsDiagnosticD";
import {PhaseMechanicsGroundedA4} from "./ShootingPhaseGroundedA4";
import {GROUNDED_A4_TOTAL_FRAMES} from "./groundedContactChoreography";
import {PhaseMechanicsSplitB} from "./ShootingPhaseMechanicsSplitB";
import {PhaseMechanicsStickerCutA3} from "./ShootingPhaseStickerCutA3";
import {MetricExplainer} from "./ShootingExplainer";
import {SlowMoMechanicsExplainer} from "./ShootingSlowMoExplainer";
import {ShootingShot} from "./ShootingShot";
import {AntigravityMechanicsExplainer} from "./ShootingAntigravityMechanicsExplainer";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="ShotAnnotationLibrary"
        component={ShotAnnotationLibrary}
        durationInFrames={1}
        fps={30}
        width={SWATCH_WIDTH}
        height={SWATCH_HEIGHT}
      />
      <Composition
        id="ContactFreezePoc"
        component={ContactFreezePoc}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ShootingShot"
        component={ShootingShot}
        durationInFrames={270}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="MetricExplainer"
        component={MetricExplainer}
        durationInFrames={390}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SlowMoMechanicsExplainer"
        component={SlowMoMechanicsExplainer}
        durationInFrames={390}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ExtendedContactSlowMoExplainer"
        component={ExtendedContactSlowMoExplainer}
        durationInFrames={570}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="CleanContactSlowMoExplainer"
        component={CleanContactSlowMoExplainer}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="CoachTimelineExplainer"
        component={CoachTimelineExplainer}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ClarityCoachExplainer"
        component={ClarityCoachExplainer}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="BiomechImplicationExplainer"
        component={BiomechImplicationExplainer}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="AnnotationCoachExplainer"
        component={AnnotationCoachExplainer}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="MeasurementFocusExplainer"
        component={MeasurementFocusExplainer}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="HudlStyleExplainer"
        component={HudlStyleExplainer}
        durationInFrames={720}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsCloseupA"
        component={PhaseMechanicsCloseupA}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsSplitB"
        component={PhaseMechanicsSplitB}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsBroadcastC"
        component={PhaseMechanicsBroadcastC}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsDiagnosticD"
        component={PhaseMechanicsDiagnosticD}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsCoachCutA2"
        component={PhaseMechanicsCoachCutA2}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsStickerCutA3"
        component={PhaseMechanicsStickerCutA3}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PhaseMechanicsGroundedA4"
        component={PhaseMechanicsGroundedA4}
        durationInFrames={GROUNDED_A4_TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{shotId: "bahoya"}}
      />
      <Composition
        id="AntigravityMechanicsExplainer"
        component={AntigravityMechanicsExplainer}
        durationInFrames={1500}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
