import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, ProbesController } from './health.controller';

/**
 * Wave D (docs/technical/10-observability-and-devops.md §5): pins the
 * liveness/readiness contract the Docker HEALTHCHECK and any future k8s
 * probes rely on. Follows this repo's plain-mock instantiation style (see
 * e.g. modules/consent/consent.service.spec.ts) rather than a full Nest
 * TestingModule — these controllers have a single trivial dependency.
 */
describe('HealthController (GET /health — unchanged legacy contract)', () => {
  function makeController(queryRaw: jest.Mock) {
    const prisma = { $queryRaw: queryRaw };
    return new HealthController(prisma as any);
  }

  it('reports db "up" when Postgres answers', async () => {
    const controller = makeController(jest.fn().mockResolvedValue([{ '?column?': 1 }]));
    const result = await controller.check();
    expect(result).toMatchObject({ status: 'ok', service: 'vpsy-api', db: 'up' });
  });

  it('reports db "down" (not a thrown error) when Postgres fails — smoke.sh depends on this shape', async () => {
    const controller = makeController(jest.fn().mockRejectedValue(new Error('connection refused')));
    const result = await controller.check();
    expect(result).toMatchObject({ status: 'ok', db: 'down' });
  });
});

describe('ProbesController.liveness (GET /healthz)', () => {
  it('reports ok without touching the database', async () => {
    const queryRaw = jest.fn();
    const controller = new ProbesController({ $queryRaw: queryRaw } as any);
    const result = controller.liveness();
    expect(result).toMatchObject({ status: 'ok', service: 'vpsy-api' });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('ProbesController.readiness (GET /readyz)', () => {
  it('reports ok + db up when Postgres answers', async () => {
    const controller = new ProbesController({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as any);
    const result = await controller.readiness();
    expect(result).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('throws a 503 ServiceUnavailableException with an honest "degraded" body when Postgres is unreachable', async () => {
    const controller = new ProbesController({
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as any);

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    try {
      await controller.readiness();
      throw new Error('expected readiness() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const response = (err as ServiceUnavailableException).getResponse();
      expect(response).toMatchObject({ status: 'degraded', db: 'down', reason: 'connection refused' });
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });
});
