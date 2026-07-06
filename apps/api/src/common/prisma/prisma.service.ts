import { Logger } from '@nestjs/common';
import { PrismaClient } from '@vpsy/database';
import { withTenantRls } from './rls.extension';

/**
 * Kept as a real (empty) class — not just a type — so every existing
 * `constructor(private readonly prisma: PrismaService)` across the codebase
 * keeps compiling and resolving via DI unchanged. The actual INJECTED
 * INSTANCE is produced by `createPrismaService()` below: a `$extends()`-
 * wrapped client (see rls.extension.ts) cast to this shape. `$extends()`
 * returns a new object that is structurally compatible with PrismaClient
 * (same model delegates, `$transaction`, etc.) but is not `instanceof
 * PrismaClient` and can't be produced by normal subclassing — hence the
 * factory-provider pattern in prisma.module.ts instead of `extends
 * PrismaClient` + overridden methods.
 */
export class PrismaService extends PrismaClient {}

const logger = new Logger('PrismaService');

/**
 * Builds the tenant-RLS-extended Prisma client used everywhere via DI.
 * Nest's lifecycle hooks (OnModuleInit/OnModuleDestroy) are duck-typed at
 * runtime (Nest calls `instance.onModuleInit()`/`onModuleDestroy()` if they
 * exist, regardless of `implements` on a class) — so they're attached
 * directly onto the extended instance here rather than declared via the
 * `PrismaService` class above.
 */
export function createPrismaService(): PrismaService {
  const base = new PrismaClient();
  const extended = withTenantRls(base);

  Object.assign(extended, {
    async onModuleInit() {
      try {
        await base.$connect();
        logger.log('Prisma connected');
      } catch (err) {
        logger.warn(`Prisma could not connect (running without DB?): ${(err as Error).message}`);
      }
    },
    async onModuleDestroy() {
      await base.$disconnect();
    },
  });

  return extended as unknown as PrismaService;
}
