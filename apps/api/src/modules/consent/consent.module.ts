import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/** Exports ConsentService so IntakeModule can enforce assertRequiredConsents before submit. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
