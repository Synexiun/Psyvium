import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OutcomesController } from './outcomes.controller';
import { OutcomesService } from './outcomes.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [OutcomesController],
  providers: [OutcomesService],
})
export class OutcomesModule {}
