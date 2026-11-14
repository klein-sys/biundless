export type TrigFunctionId = 'sin' | 'cos' | 'tan' | 'cot' | 'sec' | 'csc';

export type DerivativeSigilId =
  | 'cos'
  | 'neg_sin'
  | 'sec2'
  | 'neg_csc2'
  | 'sec_tan'
  | 'neg_csc_cot';

export interface TrigEvaluation {
  readonly value: number;
  readonly rawValue: number;
  readonly nearAsymptote: boolean;
  readonly asymptoteProximity: number;
}

export interface DerivativeSigilMeta {
  readonly id: DerivativeSigilId;
  readonly label: string;
  readonly shortFormula: string;
  readonly sourceFunction: TrigFunctionId;
  readonly hint: string;
  readonly accentHex: string;
}

export interface TrigDefinition {
  readonly id: TrigFunctionId;
  readonly formula: string;
  readonly derivativeSigil: DerivativeSigilId;
  readonly derivativeRule: string;
  readonly asymptoteDenominator: 'none' | 'cos' | 'sin';
  readonly evaluate: (theta: number) => number;
  readonly evaluateDerivative: (theta: number) => number;
}

export type StrikeOutcomeKind =
  | 'ward_shattered'
  | 'critical_stagger'
  | 'backlash'
  | 'resonance_hit'
  | 'basic_chip';

export interface WorkedExampleSnapshot {
  readonly functionId: TrigFunctionId;
  readonly functionFormula: string;
  readonly derivativeRule: string;
  readonly thetaRadians: number;
  readonly thetaPiLabel: string;
  readonly evaluatedFunction: number;
  readonly evaluatedSlope: number;
  readonly numericSlope: number;
  readonly nearAsymptote: boolean;
  readonly isCriticalPoint: boolean;
  readonly chosenSigil: DerivativeSigilId;
  readonly chosenSigilLabel: string;
  readonly isExactMatch: boolean;
  readonly damageMultiplier: number;
  readonly outcomeKind: StrikeOutcomeKind;
  readonly outcomeSummary: string;
}

const ASYMPTOTE_EPSILON = 0.08;
const MAX_CLAMPED_VALUE = 12;

function safeDenom(denom: number): number {
  if (Math.abs(denom) < ASYMPTOTE_EPSILON) {
    return denom >= 0 ? ASYMPTOTE_EPSILON : -ASYMPTOTE_EPSILON;
  }
  return denom;
}

function clampTrigMagnitude(raw: number): number {
  if (!Number.isFinite(raw)) {
    return raw >= 0 ? MAX_CLAMPED_VALUE : -MAX_CLAMPED_VALUE;
  }
  return Math.max(-MAX_CLAMPED_VALUE, Math.min(MAX_CLAMPED_VALUE, raw));
}

export const DERIVATIVE_SIGILS: readonly DerivativeSigilMeta[] = [
  {
    id: 'cos',
    label: 'cos θ',
    shortFormula: 'cos(θ)',
    sourceFunction: 'sin',
    hint: 'Derivative of sin θ',
    accentHex: '#7fb8d8',
  },
  {
    id: 'neg_sin',
    label: '−sin θ',
    shortFormula: '-sin(θ)',
    sourceFunction: 'cos',
    hint: 'Derivative of cos θ',
    accentHex: '#a389d4',
  },
  {
    id: 'sec2',
    label: 'sec² θ',
    shortFormula: 'sec²(θ)',
    sourceFunction: 'tan',
    hint: 'Derivative of tan θ (always > 0)',
    accentHex: '#5ec99a',
  },
  {
    id: 'neg_csc2',
    label: '−csc² θ',
    shortFormula: '-csc²(θ)',
    sourceFunction: 'cot',
    hint: 'Derivative of cot θ (always < 0)',
    accentHex: '#5ca99e',
  },
  {
    id: 'sec_tan',
    label: 'sec θ tan θ',
    shortFormula: 'sec(θ)tan(θ)',
    sourceFunction: 'sec',
    hint: 'Derivative of sec θ',
    accentHex: '#e09a52',
  },
  {
    id: 'neg_csc_cot',
    label: '−csc θ cot θ',
    shortFormula: '-csc(θ)cot(θ)',
    sourceFunction: 'csc',
    hint: 'Derivative of csc θ',
    accentHex: '#d66052',
  },
];

export const SIGIL_BY_ID: Record<DerivativeSigilId, DerivativeSigilMeta> = Object.fromEntries(
  DERIVATIVE_SIGILS.map((s) => [s.id, s]),
) as Record<DerivativeSigilId, DerivativeSigilMeta>;

export const TRIG_DEFINITIONS: Record<TrigFunctionId, TrigDefinition> = {
  sin: {
    id: 'sin',
    formula: 'f(θ) = sin(θ)',
    derivativeSigil: 'cos',
    derivativeRule: "d/dθ [sin(θ)] = cos(θ)",
    asymptoteDenominator: 'none',
    evaluate: (theta) => Math.sin(theta),
    evaluateDerivative: (theta) => Math.cos(theta),
  },
  cos: {
    id: 'cos',
    formula: 'f(θ) = cos(θ)',
    derivativeSigil: 'neg_sin',
    derivativeRule: "d/dθ [cos(θ)] = -sin(θ)",
    asymptoteDenominator: 'none',
    evaluate: (theta) => Math.cos(theta),
    evaluateDerivative: (theta) => -Math.sin(theta),
  },
  tan: {
    id: 'tan',
    formula: 'f(θ) = tan(θ)',
    derivativeSigil: 'sec2',
    derivativeRule: "d/dθ [tan(θ)] = sec²(θ)",
    asymptoteDenominator: 'cos',
    evaluate: (theta) => Math.sin(theta) / safeDenom(Math.cos(theta)),
    evaluateDerivative: (theta) => {
      const c = safeDenom(Math.cos(theta));
      return 1 / (c * c);
    },
  },
  cot: {
    id: 'cot',
    formula: 'f(θ) = cot(θ)',
    derivativeSigil: 'neg_csc2',
    derivativeRule: "d/dθ [cot(θ)] = -csc²(θ)",
    asymptoteDenominator: 'sin',
    evaluate: (theta) => Math.cos(theta) / safeDenom(Math.sin(theta)),
    evaluateDerivative: (theta) => {
      const s = safeDenom(Math.sin(theta));
      return -1 / (s * s);
    },
  },
  sec: {
    id: 'sec',
    formula: 'f(θ) = sec(θ)',
    derivativeSigil: 'sec_tan',
    derivativeRule: "d/dθ [sec(θ)] = sec(θ)·tan(θ)",
    asymptoteDenominator: 'cos',
    evaluate: (theta) => 1 / safeDenom(Math.cos(theta)),
    evaluateDerivative: (theta) => {
      const c = safeDenom(Math.cos(theta));
      return Math.sin(theta) / (c * c);
    },
  },
  csc: {
    id: 'csc',
    formula: 'f(θ) = csc(θ)',
    derivativeSigil: 'neg_csc_cot',
    derivativeRule: "d/dθ [csc(θ)] = -csc(θ)·cot(θ)",
    asymptoteDenominator: 'sin',
    evaluate: (theta) => 1 / safeDenom(Math.sin(theta)),
    evaluateDerivative: (theta) => {
      const s = safeDenom(Math.sin(theta));
      return -Math.cos(theta) / (s * s);
    },
  },
};

function computeAsymptoteState(
  denomKind: TrigDefinition['asymptoteDenominator'],
  theta: number,
): { nearAsymptote: boolean; asymptoteProximity: number } {
  if (denomKind === 'none') {
    return { nearAsymptote: false, asymptoteProximity: 0 };
  }
  const denom = denomKind === 'cos' ? Math.abs(Math.cos(theta)) : Math.abs(Math.sin(theta));
  const nearAsymptote = denom < ASYMPTOTE_EPSILON;
  // Smooth 0..1 warning gauge as denominator approaches zero within 0.35 rad
  const asymptoteProximity = Math.max(0, Math.min(1, 1 - denom / 0.35));
  return { nearAsymptote, asymptoteProximity };
}

export function expectedDerivativeFor(fn: TrigFunctionId): DerivativeSigilId {
  return TRIG_DEFINITIONS[fn].derivativeSigil;
}

export function evaluateTrig(fn: TrigFunctionId, theta: number): TrigEvaluation {
  const def = TRIG_DEFINITIONS[fn];
  const { nearAsymptote, asymptoteProximity } = computeAsymptoteState(def.asymptoteDenominator, theta);
  const rawValue = def.evaluate(theta);
  return {
    value: clampTrigMagnitude(rawValue),
    rawValue,
    nearAsymptote,
    asymptoteProximity,
  };
}

export function evaluateExactDerivative(fn: TrigFunctionId, theta: number): TrigEvaluation {
  const def = TRIG_DEFINITIONS[fn];
  const { nearAsymptote, asymptoteProximity } = computeAsymptoteState(def.asymptoteDenominator, theta);
  const rawValue = def.evaluateDerivative(theta);
  return {
    value: clampTrigMagnitude(rawValue),
    rawValue,
    nearAsymptote,
    asymptoteProximity,
  };
}

/** Independent central finite-difference approximation for Dev Telemetry & tests. */
export function evaluateNumericDerivative(fn: TrigFunctionId, theta: number, h = 1e-4): number {
  const def = TRIG_DEFINITIONS[fn];
  const fPlus = def.evaluate(theta + h);
  const fMinus = def.evaluate(theta - h);
  return clampTrigMagnitude((fPlus - fMinus) / (2 * h));
}

export function isCriticalPoint(fn: TrigFunctionId, theta: number, tolerance = 0.08): boolean {
  const deriv = evaluateExactDerivative(fn, theta);
  return !deriv.nearAsymptote && Math.abs(deriv.value) <= tolerance;
}

export function formatThetaPi(theta: number): string {
  const ratio = theta / Math.PI;
  const rounded = Math.round(ratio * 100) / 100;
  if (Math.abs(rounded) < 0.01) return '0.00π';
  return `${rounded.toFixed(2)}π (${theta.toFixed(2)} rad)`;
}

const OUTCOME_DESCRIPTIONS: Record<StrikeOutcomeKind, string> = {
  critical_stagger:
    'Ward Shattered at Critical Point (f′(θ) ≈ 0): Zero-slope resonance triggers maximum Critical Stagger and 5.0× multiplier.',
  ward_shattered:
    'Ward Shattered: Chosen sigil matches f′(θ), breaking the boss Phase Ward and amplifying Resonance Damage.',
  resonance_hit:
    'Resonance Strike Connected: Attuned derivative aligns with the active wave slope f′(θ).',
  backlash:
    'Derivative Mismatch — Arcane Backlash: Chosen sigil disagrees with f′(θ); strike deflected to 0.25× and triggers shockwave.',
  basic_chip:
    'Basic Blade Combo: Physical chip damage dealt without consuming a Resonance Sigil.',
};

export function buildWorkedExample(
  fn: TrigFunctionId,
  theta: number,
  chosenSigil: DerivativeSigilId,
  outcomeKind: StrikeOutcomeKind,
  damageMultiplier: number,
): WorkedExampleSnapshot {
  const def = TRIG_DEFINITIONS[fn];
  const fEval = evaluateTrig(fn, theta);
  const dEval = evaluateExactDerivative(fn, theta);
  const numSlope = evaluateNumericDerivative(fn, theta);
  const sigilMeta = SIGIL_BY_ID[chosenSigil];

  return {
    functionId: fn,
    functionFormula: def.formula,
    derivativeRule: def.derivativeRule,
    thetaRadians: theta,
    thetaPiLabel: formatThetaPi(theta),
    evaluatedFunction: fEval.value,
    evaluatedSlope: dEval.value,
    numericSlope: numSlope,
    nearAsymptote: dEval.nearAsymptote,
    isCriticalPoint: isCriticalPoint(fn, theta),
    chosenSigil,
    chosenSigilLabel: sigilMeta.label,
    isExactMatch: chosenSigil === def.derivativeSigil,
    damageMultiplier,
    outcomeKind,
    outcomeSummary: OUTCOME_DESCRIPTIONS[outcomeKind],
  };
}

export interface WavePlotData {
  readonly pathData: string;
  readonly tangentLine: { x1: number; y1: number; x2: number; y2: number };
  readonly contactPoint: { x: number; y: number };
  readonly axisY: number;
  readonly width: number;
  readonly height: number;
  readonly ticks: Array<{ x: number; label: string }>;
}

export function generateWavePlotData(
  fn: TrigFunctionId,
  theta: number,
  width: number = 360,
  height: number = 130,
): WavePlotData {
  const padX = 24;
  const plotW = width - padX * 2;
  const axisY = height / 2;
  const yScale = 22;
  const maxClamp = 2.4;

  const samples = 48;
  const points: Array<[number, number]> = [];

  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = padX + (i / samples) * plotW;
    const val = evaluateTrig(fn, t).value;
    const clamped = Math.max(-maxClamp, Math.min(maxClamp, val));
    const y = axisY - clamped * yScale;
    points.push([x, y]);
  }

  let pathData = '';
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    if (i === 0) pathData += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
    else pathData += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  }

  const normTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const cx = padX + (normTheta / (Math.PI * 2)) * plotW;
  const cVal = evaluateTrig(fn, normTheta).value;
  const cy = axisY - Math.max(-maxClamp, Math.min(maxClamp, cVal)) * yScale;

  const slope = evaluateExactDerivative(fn, normTheta).value;
  const dPixelSlope = -slope * yScale * ((Math.PI * 2) / plotW);
  const tanAngle = Math.atan(dPixelSlope);
  const span = 42;

  const x1 = cx - Math.cos(tanAngle) * span;
  const y1 = cy - Math.sin(tanAngle) * span;
  const x2 = cx + Math.cos(tanAngle) * span;
  const y2 = cy + Math.sin(tanAngle) * span;

  const tickFractions = [
    { frac: 0, label: '0' },
    { frac: 0.25, label: 'π/2' },
    { frac: 0.5, label: 'π' },
    { frac: 0.75, label: '3π/2' },
    { frac: 1.0, label: '2π' },
  ];

  const ticks = tickFractions.map(({ frac, label }) => ({
    x: padX + frac * plotW,
    label,
  }));

  return {
    pathData,
    tangentLine: {
      x1: Number(x1.toFixed(1)),
      y1: Number(y1.toFixed(1)),
      x2: Number(x2.toFixed(1)),
      y2: Number(y2.toFixed(1)),
    },
    contactPoint: {
      x: Number(cx.toFixed(1)),
      y: Number(cy.toFixed(1)),
    },
    axisY,
    width,
    height,
    ticks,
  };
}

