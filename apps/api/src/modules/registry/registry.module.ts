import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClientRegistryController, PsychologistRegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ClientRegistryController, PsychologistRegistryController],
  providers: [RegistryService],
})
export class RegistryModule {}
