import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@vpsy/database';

/**
 * Single Prisma client for the modular monolith. In a future extraction, each
 * service gets its own; the ports that consume this stay unchanged.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected');
    } catch (err) {
      this.logger.warn(`Prisma could not connect (running without DB?): ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
