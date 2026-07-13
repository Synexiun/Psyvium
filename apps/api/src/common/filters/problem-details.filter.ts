import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * RFC 9457 Problem Details for HTTP APIs.
 * Production never leaks stack traces or internal exception messages for 5xx.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code: string | undefined;
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
        title = HttpStatus[status] ?? title;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        title = typeof obj.error === 'string' ? obj.error : (HttpStatus[status] ?? title);
        if (typeof obj.message === 'string') detail = obj.message;
        else if (Array.isArray(obj.message)) detail = obj.message.join('; ');
        if (typeof obj.code === 'string') code = obj.code;
        // Preserve structured fields (e.g. MFA codes) without dumping stacks.
        const { message: _m, error: _e, statusCode: _s, ...rest } = obj;
        extra = rest;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error on ${req.method} ${req.url}: ${exception.message}`,
        exception.stack,
      );
      detail = this.isProd ? 'An unexpected error occurred' : exception.message;
    } else {
      this.logger.error(`Unhandled non-Error throw on ${req.method} ${req.url}`);
      detail = this.isProd ? 'An unexpected error occurred' : String(exception);
    }

    // Never expose raw stack / SQL / filesystem paths in production 5xx bodies.
    if (this.isProd && status >= 500) {
      detail = 'An unexpected error occurred';
      extra = {};
    }

    res.status(status).type('application/problem+json').json({
      type: `https://httpstatuses.com/${status}`,
      title,
      status,
      detail,
      instance: req.originalUrl ?? req.url,
      ...(code ? { code } : {}),
      ...extra,
    });
  }
}
