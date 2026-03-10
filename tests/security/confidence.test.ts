import { describe, expect, it } from 'bun:test';
import {
  checkConfidence,
  DEFAULT_CONFIDENCE_CONFIG,
  type ConfidenceConfig,
} from '../../core/security/confidence.js';

describe('checkConfidence', () => {
  it('allows classification at exact threshold (0.8)', () => {
    const r = checkConfidence('classification', 0.8);
    expect(r.allowed).toBe(true);
    expect(r.threshold).toBe(0.8);
    expect(r.reason).toBeUndefined();
  });

  it('allows classification above threshold', () => {
    const r = checkConfidence('classification', 0.95);
    expect(r.allowed).toBe(true);
  });

  it('blocks classification below threshold', () => {
    const r = checkConfidence('classification', 0.79);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('0.79');
    expect(r.reason).toContain('0.8');
  });

  it('uses spamDetection threshold (0.85)', () => {
    expect(checkConfidence('spamDetection', 0.85).allowed).toBe(true);
    expect(checkConfidence('spamDetection', 0.84).allowed).toBe(false);
  });

  it('uses duplicateDetection threshold (0.8)', () => {
    expect(checkConfidence('duplicateDetection', 0.8).allowed).toBe(true);
    expect(checkConfidence('duplicateDetection', 0.79).allowed).toBe(false);
  });

  it('blocks unknown actions with reason', () => {
    const r = checkConfidence('nonexistent', 0.99);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Unknown action');
  });

  it('supports custom per-action overrides', () => {
    const config: ConfidenceConfig = {
      ...DEFAULT_CONFIDENCE_CONFIG,
      custom: { myAction: 0.5 },
    };
    expect(checkConfidence('myAction', 0.5, config).allowed).toBe(true);
    expect(checkConfidence('myAction', 0.49, config).allowed).toBe(false);
  });

  it('custom override takes priority over built-in', () => {
    const config: ConfidenceConfig = {
      ...DEFAULT_CONFIDENCE_CONFIG,
      custom: { classification: 0.5 },
    };
    // Custom says 0.5, built-in says 0.8 — custom wins
    expect(checkConfidence('classification', 0.5, config).allowed).toBe(true);
    expect(checkConfidence('classification', 0.49, config).allowed).toBe(false);
  });

  it('returns correct threshold in result', () => {
    const r = checkConfidence('spamDetection', 0.5);
    expect(r.threshold).toBe(0.85);
  });

  it('DEFAULT_CONFIDENCE_CONFIG has expected values', () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.classification).toBe(0.8);
    expect(DEFAULT_CONFIDENCE_CONFIG.duplicateDetection).toBe(0.8);
    expect(DEFAULT_CONFIDENCE_CONFIG.spamDetection).toBe(0.85);
    expect(DEFAULT_CONFIDENCE_CONFIG.custom).toEqual({});
  });
});
