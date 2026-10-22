export const INDUSTRIAL_DATA_SHA256 = 'f20d5673d8cfd9021604b6b80dda59384a7e65ef5ef45adc54162308ff53245a';
export const INDUSTRIAL_CASES = Object.freeze({
  industrial: Object.freeze({part: '3-29-00350', sha256: INDUSTRIAL_DATA_SHA256}),
  industrial_00289: Object.freeze({part: '3-29-00289', sha256: '0f375401f5cfe0e19e00aed12e235810ec8f54e928fb5c774fc8ffbdcea0dbb0'}),
});

// The provider has verified these exact bytes before offering this UI route.
// Learning operations independently check the complete parsed case identity.
export function industrialLearningSupported(data, provenance) {
  const expected = INDUSTRIAL_CASES[data?.scenes?.[0]?.id];
  return data?.scenes?.length === 1 && !!expected && provenance?.case_sha256 === expected.sha256;
}
