import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WearablesController } from './wearables.controller';
import { WearablesService } from './wearables.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [WearablesController],
  providers: [WearablesService],
  exports: [WearablesService],
})
export class WearablesModule {}
