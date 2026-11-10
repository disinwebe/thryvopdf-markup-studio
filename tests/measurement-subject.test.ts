import { describe, expect, it } from 'vitest';
import { shouldResetMeasurementSubject } from '../src/app/model';
import { DISCIPLINE_LIST } from '../src/core/types';

describe('measurement subject defaults', () => {
  it('keeps the subject while the same measurement tool is active', () => {
    expect(shouldResetMeasurementSubject('m-count', 'm-count')).toBe(false);
  });

  it('resets the subject when switching to another takeoff measurement tool', () => {
    expect(shouldResetMeasurementSubject('m-count', 'm-area')).toBe(true);
    expect(shouldResetMeasurementSubject('m-length', 'm-count')).toBe(true);
  });

  it('does not reset the subject for non-takeoff tools', () => {
    expect(shouldResetMeasurementSubject('m-count', 'select')).toBe(false);
    expect(shouldResetMeasurementSubject('m-count', 'calibrate')).toBe(false);
  });
});

describe('registration disciplines', () => {
  it.each(['Instrumentation', 'Process', 'Piping'])('includes %s', (discipline) => {
    expect(DISCIPLINE_LIST).toContain(discipline);
  });
});
