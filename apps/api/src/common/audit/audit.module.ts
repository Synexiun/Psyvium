import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditChainAnchorService } from './audit-chain-anchor.service';

@Global()
@Module({
  imports: [JwtModule.register({}), ScheduleModule.forRoot()],
  controllers: [AuditController],
  providers: [AuditService, AuditChainAnchorService],
  exports: [AuditService, AuditChainAnchorService],
})
export class AuditModule {}
