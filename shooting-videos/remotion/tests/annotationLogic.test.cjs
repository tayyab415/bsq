const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "annotationLogic.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
});

const moduleExports = {};
const virtualModule = {exports: moduleExports};
new Function("exports", "module", compiled.outputText)(moduleExports, virtualModule);

const {buildAnnotationBeats, formatMetricDistance, phaseBeatId} = virtualModule.exports;

assert.equal(formatMetricDistance("0.1027"), "0.10m");
assert.equal(formatMetricDistance("-0.3626"), "0.36m");
assert.equal(formatMetricDistance("bad"), "-");

const standoutBeats = buildAnnotationBeats({
  role: "standout",
  score: {
    P3_score: "87.8",
    P4_score: "94.1",
    P5_score: "93.3",
    technique_mechanics_score: "88.2",
  },
  features: {
    min_foot_ball_distance_m: "0.1027",
    plant_foot_lateral_offset_m: "-0.3626",
    peak_shoulder_hip_separation_deg: "17.433",
    foot_velocity_into_ball_m_s: "15.861",
    ball_exit_speed_m_s: "31.859",
  },
});

assert.deepEqual(
  standoutBeats.map((beat) => beat.id),
  ["contact-gap", "plant-base", "hip-shoulder", "foot-path", "ball-path"],
);
assert.equal(standoutBeats[0].label, "0.10m contact gap");
assert.equal(standoutBeats[0].visual, "distance-line");
assert.deepEqual(standoutBeats[0].anchors, ["strikeFoot", "ball"]);
assert.equal(standoutBeats[1].label, "0.36m plant base");
assert.equal(standoutBeats[2].label, "17.4 deg hip-shoulder");
assert.match(standoutBeats[2].implication, /torque/i);
assert.match(standoutBeats[3].implication, /swing/i);
assert.match(standoutBeats[4].implication, /output/i);

assert.equal(phaseBeatId("contact hold"), "contact-gap");
assert.equal(phaseBeatId("mechanics breakdown"), "hip-shoulder");
assert.equal(phaseBeatId("release path"), "ball-path");
assert.equal(phaseBeatId("approach to contact"), "foot-path");

const constraintBeats = buildAnnotationBeats({
  role: "constraint",
  score: {
    P3_score: "52.9",
    P4_score: "58.7",
    P5_score: "32.6",
    technique_mechanics_score: "49.7",
  },
  features: {
    min_foot_ball_distance_m: "0.2761",
    plant_foot_lateral_offset_m: "0.4484",
    peak_shoulder_hip_separation_deg: "25.694",
    foot_velocity_into_ball_m_s: "10.039",
    ball_exit_speed_m_s: "27.280",
  },
});

assert.equal(constraintBeats[0].label, "0.28m contact gap");
assert.match(constraintBeats[0].implication, /leak|correction|mishit/i);
assert.match(constraintBeats[1].implication, /unstable|brace/i);

console.log("annotationLogic tests passed");
