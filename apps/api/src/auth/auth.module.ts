import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FieldCipherModule } from '../common/crypto/field-cipher.module';
import { EmailModule } from '../common/email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({}), FieldCipherModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
