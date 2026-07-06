import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SchedulingController],
  providers: [SchedulingService],
})
export class SchedulingModule {}
