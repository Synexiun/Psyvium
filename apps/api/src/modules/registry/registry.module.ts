import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  ClientRegistryController,
  PsychologistRegistryController,
  RegistryInviteController,
} from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ClientRegistryController, PsychologistRegistryController, RegistryInviteController],
  providers: [RegistryService],
})
export class RegistryModule {}
