import { formatDerivativeExpression, TRIG_DEFINITIONS, type TrigFunctionId } from './trigDerivatives';

const PRACTICE: Record<TrigFunctionId, {
  factor: number;
  inputDivisor: number;
  evaluation: readonly string[];
  outsideValue: string;
}> = {
  sin: { factor: 3, inputDivisor: 9, evaluation: ['cos(π/3) = 1/2'], outsideValue: '(1/2)' },
  cos: { factor: 4, inputDivisor: 8, evaluation: ['sin(π/2) = 1'], outsideValue: '(−1)' },
  tan: {
    factor: 2, inputDivisor: 6,
    evaluation: ['cos(π/3) = 1/2', 'sec²(π/3) = (1 ÷ (1/2))² = 2² = 4'],
    outsideValue: '4',
  },
  cot: {
    factor: 2, inputDivisor: 12,
    evaluation: ['sin(π/6) = 1/2', '−csc²(π/6) = −(1 ÷ (1/2))² = −4'],
    outsideValue: '(−4)',
  },
  sec: {
    factor: 2, inputDivisor: 8,
    evaluation: ['sec(π/4) = √2', 'tan(π/4) = 1'],
    outsideValue: '√2',
  },
  csc: {
    factor: 2, inputDivisor: 8,
    evaluation: ['csc(π/4) = √2', 'cot(π/4) = 1'],
    outsideValue: '(−√2)',
  },
};

export function getTrigPracticeExample(fn: TrigFunctionId) {
  const { factor, inputDivisor, evaluation, outsideValue } = PRACTICE[fn];
  const inside = `${factor}x`;
  const input = `π/${inputDivisor}`;
  const insideDivisor = inputDivisor / factor;
  const exactSlope = factor * TRIG_DEFINITIONS[fn].evaluateDerivative(Math.PI / insideDivisor, false);
  const slope = Number(exactSlope.toFixed(3));
  const comparison = Math.abs(exactSlope - slope) < 1e-10 ? '=' : '≈';
  const outsideDerivative = formatDerivativeExpression(fn, inside);

  return {
    problem: `y = ${fn}(${inside})`,
    inside,
    factor,
    outsideRule: `d/du [${fn}(u)] = ${formatDerivativeExpression(fn, 'u')}`,
    derivative: `y′ = ${factor} × ${outsideDerivative.startsWith('−') ? `(${outsideDerivative})` : outsideDerivative}`,
    input,
    inputDegrees: 180 / inputDivisor,
    evaluatedInside: `π/${insideDivisor}`,
    evaluatedInsideDegrees: 180 / insideDivisor,
    evaluation,
    answer: `${factor} × ${outsideValue} ${comparison} ${String(slope).replace('-', '−')}`,
    slope,
  };
}
