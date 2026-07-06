import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}
