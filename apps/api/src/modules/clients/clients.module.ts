import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WearablesModule } from '../wearables/wearables.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [JwtModule.register({}), WearablesModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
