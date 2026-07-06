import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CliniciansController } from './clinicians.controller';
import { CliniciansService } from './clinicians.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CliniciansController],
  providers: [CliniciansService],
})
export class CliniciansModule {}
