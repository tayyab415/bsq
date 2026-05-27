import {getInputProps} from "remotion";
import bahoya from "../public/template-a/bahoya.json";
import gnabry from "../public/template-a/gnabry.json";
import goretzka from "../public/template-a/goretzka.json";

export type GroundedClipBundle = {
  clips: Array<Record<string, unknown>>;
};

const TEMPLATE_A_CLIPS: Record<string, GroundedClipBundle> = {
  bahoya: bahoya as GroundedClipBundle,
  gnabry: gnabry as GroundedClipBundle,
  goretzka: goretzka as GroundedClipBundle,
};

export type TemplateAShotId = keyof typeof TEMPLATE_A_CLIPS;

export const TEMPLATE_A_SHOT_IDS = Object.keys(TEMPLATE_A_CLIPS) as TemplateAShotId[];

export function groundedClipBundle(): GroundedClipBundle {
  const props = getInputProps() as {shotId?: string};
  const shotId = props.shotId && props.shotId in TEMPLATE_A_CLIPS ? props.shotId : "bahoya";
  return TEMPLATE_A_CLIPS[shotId];
}
