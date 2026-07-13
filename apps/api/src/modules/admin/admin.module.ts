import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FeatureFlagsModule } from '../../common/feature-flags/feature-flags.module';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [JwtModule.register({}), FeatureFlagsModule, FieldCipherModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
