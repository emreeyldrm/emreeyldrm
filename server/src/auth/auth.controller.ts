import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { Public } from '../common/public.decorator'
import { LoginDto, RegisterDto } from './auth.dto'
import { AuthService } from './auth.service'

@Public()
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto) }

  @HttpCode(200)
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto) }
}
