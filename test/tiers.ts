export const tiers = [
  { name: "static", suffix: ".static.ts", inGate: true },
  { name: "unit", suffix: ".test.ts", inGate: true },
  { name: "int", suffix: ".int.ts", inGate: true },
  { name: "browser", suffix: ".browser.ts", inGate: true },
  { name: "live", suffix: ".live.ts", inGate: false },
] as const;

export type Tier = (typeof tiers)[number];

export function tierPattern(tier: Tier): string {
  return `**/*${tier.suffix}`;
}
