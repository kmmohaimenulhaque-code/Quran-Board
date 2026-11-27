import { describe, it, expect } from 'vitest';
import { computeAyahEndedTransition } from '../state-machine';

describe('Full-Range Block Repetition FSM (1..N)', () => {
  it('steps sequentially through ayahs within a pass', () => {
    expect(computeAyahEndedTransition(1, 3, 0, 5)).toEqual({
      nextPhase: 'PLAYING',
      nextPass: 1,
      nextAyahIdx: 1
    });
  });

  it('triggers PASS_RESET after final ayah when pass < N', () => {
    expect(computeAyahEndedTransition(1, 3, 4, 5)).toEqual({
      nextPhase: 'PASS_RESET',
      nextPass: 2,
      nextAyahIdx: 0
    });
    expect(computeAyahEndedTransition(2, 3, 4, 5)).toEqual({
      nextPhase: 'PASS_RESET',
      nextPass: 3,
      nextAyahIdx: 0
    });
  });

  it('transitions to COMPLETED on final ayah of final pass', () => {
    expect(computeAyahEndedTransition(3, 3, 4, 5)).toEqual({
      nextPhase: 'COMPLETED',
      nextPass: 3,
      nextAyahIdx: 4
    });
  });

  it('handles single-ayah single-pass block cleanly', () => {
    expect(computeAyahEndedTransition(1, 1, 0, 1)).toEqual({
      nextPhase: 'COMPLETED',
      nextPass: 1,
      nextAyahIdx: 0
    });
  });
});
