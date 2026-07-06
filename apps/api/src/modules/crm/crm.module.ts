import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
