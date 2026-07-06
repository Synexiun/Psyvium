import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Original single-endpoint smoke check. Left byte-for-byte as-is —
   * scripts/smoke.sh asserts on its `db` field — even though it now overlaps
   * with GET /readyz below. New callers (k8s probes, the Docker HEALTHCHECK)
   * should prefer /healthz and /readyz (docs/technical/10-observability-and-
   * devops.md §5); this route stays for backward compatibility.
   */
  @Get()
  async check() {
    let db = 'unknown';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: 'ok',
      service: 'vpsy-api',
      version: '0.1.0',
      db,
      time: new Date().toISOString(),
    };
  }
}

/**
 * K8s-ready liveness/readiness probes (docs/technical/10-observability-and-devops.md
 * §5: "the API is stateless ... with liveness (`/healthz`), readiness (`/readyz`),
 * and startup probes"). Deliberately a separate controller/route tree from
 * HealthController above so GET /health's contract (and scripts/smoke.sh, which
 * depends on it) is never disturbed by probe changes.
 *
 * Note on path: the app's global prefix is `api/v1` (set in main.ts, out of
 * scope for this change), so these resolve to `/api/v1/healthz` and
 * `/api/v1/readyz` rather than bare `/healthz`/`/readyz`. A future change that
 * exempts probe routes from the global prefix (via NestFactory's
 * `setGlobalPrefix(..., { exclude: [...] })`) would need to touch main.ts.
 */
@ApiTags('health')
@Controller()
export class ProbesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness: is the process itself up and able to handle requests?
   * Intentionally never touches the database — a slow/unreachable Postgres
   * must not make an orchestrator kill+restart an otherwise-healthy pod
   * (that would just compound an outage with a restart storm). Readiness
   * (below) is where dependency health is checked.
   */
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok', service: 'vpsy-api', time: new Date().toISOString() };
  }

  /**
   * Readiness: are this instance's dependencies (Postgres) reachable? A
   * failure returns 503 with an honest "degraded" body (never a silent 200)
   * so an orchestrator pulls the pod out of load-balancer rotation until the
   * dependency recovers, rather than routing traffic to an instance that
   * cannot serve it.
   */
  @Get('readyz')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'vpsy-api', db: 'up', time: new Date().toISOString() };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'vpsy-api',
        db: 'down',
        reason: err instanceof Error ? err.message : 'unknown',
        time: new Date().toISOString(),
      });
    }
  }
}
