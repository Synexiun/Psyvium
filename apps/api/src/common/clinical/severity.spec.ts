import { SeverityBand } from '@vpsy/contracts';
import { isSeverityEscalation, maxSeverity, severityRank } from './severity';

describe('clinical severity lattice', () => {
  it('ranks SEVERE above HIGH', () => {
    expect(severityRank(SeverityBand.SEVERE)).toBeGreaterThan(severityRank(SeverityBand.HIGH));
  });

  it('detects escalate-only transitions', () => {
    expect(isSeverityEscalation('LOW', 'HIGH')).toBe(true);
    expect(isSeverityEscalation('SEVERE', 'MODERATE')).toBe(false);
  });

  it('picks the clinical max of two bands', () => {
    expect(maxSeverity('MODERATE', 'HIGH')).toBe('HIGH');
  });
});
