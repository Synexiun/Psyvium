import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { ConsentModule } from '../consent/consent.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { ScreeningService } from './screening.service';

@Module({
  imports: [JwtModule.register({}), ConsentModule, FieldCipherModule],
  controllers: [IntakeController],
  providers: [IntakeService, ScreeningService],
  exports: [ScreeningService],
})
export class IntakeModule {}
