import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest();
    return req.principal as AuthPrincipal;
  },
);
