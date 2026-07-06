import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TelehealthController } from './telehealth.controller';
import { TelehealthService } from './telehealth.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [TelehealthController],
  providers: [TelehealthService],
})
export class TelehealthModule {}
