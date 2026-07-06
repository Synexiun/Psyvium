import { ExecutionContext, HttpException, Injectable, Logger, NestInterceptor, type CallHandler } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VpsyMetrics } from './vpsy-metrics.service';

/** `app.setGlobalPrefix('api/v1')` in `main.ts` — kept as a literal here rather than re-deriving it. */
const LOGIN_ROUTE = '/api/v1/auth/login';

/**
 * Increments `auth.login.failed` on a failed `POST /auth/login` — the one
 * requested Availability/security metric that has NO event to hang off of.
 *
 * WHY AN INTERCEPTOR INSTEAD OF SUBSCRIBING TO A BUS EVENT (like every other
 * counter in this module): `auth.service.ts#login` throws a plain
 * `UnauthorizedException('Invalid credentials')` (or an MFA-required/invalid
 * variant) on a bad login — it never calls `EventBus.publish(...)`. Adding
 * that publish call would mean editing `auth.service.ts`, which is a
 * publishing service OUTSIDE this task's owned paths
 * (`common/observability/**` + a narrowly-scoped `app.module.ts` registration
 * only). So this counter is raised the only way possible without touching
 * that file: a global interceptor that watches the RESPONSE side of the one
 * route it cares about.
 *
 * DELIBERATELY NARROW — this must never become a general error-swallowing
 * filter: it matches on (method === POST) AND (path === exactly the login
 * route) AND (status === 401), does the one `add(1)`, and then RE-THROWS the
 * original exception completely unchanged via `throwError`. Every other
 * route, every other status code, and every non-HttpException error passes
 * through this interceptor as if it were not registered at all. If a request
 * doesn't match, `catchError`'s predicate work costs a couple of string
 * comparisons — everything else about the response pipeline is untouched.
 */
@Injectable()
export class AuthLoginFailureMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuthLoginFailureMetricsInterceptor.name);

  constructor(private readonly metrics: VpsyMetrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const isLoginRoute = req.method === 'POST' && stripQuery(req.originalUrl ?? req.url) === LOGIN_ROUTE;

    return next.handle().pipe(
      catchError((err: unknown) => {
        if (isLoginRoute && err instanceof HttpException && err.getStatus() === 401) {
          try {
            this.metrics.authLoginFailed.add(1);
          } catch (metricErr) {
            // A metrics-recording failure must never mask the real auth error
            // the caller is about to receive — log and continue to rethrow.
            this.logger.error(`failed to record auth.login.failed: ${(metricErr as Error).message}`);
          }
        }
        return throwError(() => err); // always rethrow unchanged — never swallow
      }),
    );
  }
}

function stripQuery(path: string): string {
  const i = path.indexOf('?');
  return i === -1 ? path : path.slice(0, i);
}
