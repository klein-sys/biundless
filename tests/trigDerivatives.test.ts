import { describe, expect, it } from 'vitest';
import {
  TRIG_DEFINITIONS,
  buildWorkedExample,
  evaluateExactDerivative,
  evaluateNumericDerivative,
  evaluateTrig,
  expectedDerivativeFor,
  formatThetaPi,
  isCriticalPoint,
  type TrigFunctionId,
} from '../src/math/trigDerivatives';

describe('trigDerivatives seam', () => {
  it('maps each of the 6 basic trigonometric functions to its exact derivative sigil', () => {
    expect(expectedDerivativeFor('sin')).toBe('cos');
    expect(expectedDerivativeFor('cos')).toBe('neg_sin');
    expect(expectedDerivativeFor('tan')).toBe('sec2');
    expect(expectedDerivativeFor('cot')).toBe('neg_csc2');
    expect(expectedDerivativeFor('sec')).toBe('sec_tan');
    expect(expectedDerivativeFor('csc')).toBe('neg_csc_cot');
    expect(Object.keys(TRIG_DEFINITIONS)).toHaveLength(6);
  });

  it('matches finite-difference numeric derivatives across safe angles', () => {
    const fns: TrigFunctionId[] = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc'];
    const safeAngles = [0.4, 0.95, 2.15, -0.65];

    for (const fn of fns) {
      for (const theta of safeAngles) {
        const exact = evaluateExactDerivative(fn, theta);
        const numeric = evaluateNumericDerivative(fn, theta);
        expect(exact.nearAsymptote).toBe(false);
        expect(Number.isFinite(exact.value)).toBe(true);
        expect(exact.value).toBeCloseTo(numeric, 4);
      }
    }
  });

  it('detects critical points where f\'(theta) = 0', () => {
    expect(isCriticalPoint('sin', Math.PI / 2)).toBe(true);
    expect(isCriticalPoint('cos', Math.PI)).toBe(true);
    expect(isCriticalPoint('sin', 0.4)).toBe(false);
    expect(isCriticalPoint('tan', 0)).toBe(false); // sec^2(0) = 1 != 0
  });

  it('guards against division-by-zero spikes near vertical asymptotes', () => {
    const nearHalfPi = Math.PI / 2 - 0.001;
    const tanVal = evaluateTrig('tan', nearHalfPi);
    const tanDeriv = evaluateExactDerivative('tan', nearHalfPi);
    const secDeriv = evaluateExactDerivative('sec', nearHalfPi);

    expect(tanVal.nearAsymptote).toBe(true);
    expect(tanDeriv.nearAsymptote).toBe(true);
    expect(secDeriv.nearAsymptote).toBe(true);
    expect(Number.isFinite(tanVal.value)).toBe(true);
    expect(Number.isFinite(tanDeriv.value)).toBe(true);
    expect(Number.isFinite(secDeriv.value)).toBe(true);

    const nearZero = 0.001;
    const cotDeriv = evaluateExactDerivative('cot', nearZero);
    const cscDeriv = evaluateExactDerivative('csc', nearZero);
    expect(cotDeriv.nearAsymptote).toBe(true);
    expect(cscDeriv.nearAsymptote).toBe(true);
    expect(Number.isFinite(cotDeriv.value)).toBe(true);
    expect(Number.isFinite(cscDeriv.value)).toBe(true);
  });

  it('formats theta in multiples of pi and builds a MATH 101 worked example', () => {
    expect(formatThetaPi(Math.PI / 2)).toContain('π');
    const example = buildWorkedExample('sin', Math.PI / 3, 'cos', 'ward_shattered', 3.4);
    expect(example.functionFormula).toContain('sin');
    expect(example.derivativeRule).toContain('cos');
    expect(example.evaluatedSlope).toBeCloseTo(0.5, 4);
    expect(example.outcomeSummary).toContain('Shattered');
    expect(example.damageMultiplier).toBeCloseTo(3.4, 2);
  });
});
