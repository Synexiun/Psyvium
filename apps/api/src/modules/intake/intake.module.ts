import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConsentModule } from '../consent/consent.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { ScreeningService } from './screening.service';

@Module({
  imports: [JwtModule.register({}), ConsentModule],
  controllers: [IntakeController],
  providers: [IntakeService, ScreeningService],
  exports: [ScreeningService],
})
export class IntakeModule {}
