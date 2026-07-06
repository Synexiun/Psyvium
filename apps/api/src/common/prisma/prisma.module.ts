import { Global, Module } from '@nestjs/common';
import { PrismaService, createPrismaService } from './prisma.service';

@Global()
@Module({
  providers: [{ provide: PrismaService, useFactory: createPrismaService }],
  exports: [PrismaService],
})
export class PrismaModule {}
