import { Module } from '@nestjs/common';
import { HealthController, ProbesController } from './health.controller';

@Module({
  controllers: [HealthController, ProbesController],
})
export class HealthModule {}
