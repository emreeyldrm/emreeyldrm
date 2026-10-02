import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { DataSource } from 'typeorm'
import { IS_PUBLIC } from './public.decorator'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private db: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true
    const req = ctx.switchToHttp().getRequest()
    const header: string = req.headers['authorization'] ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    let userId: number
    try {
      const payload = await this.jwt.verifyAsync(token)
      userId = Number(payload.sub)
    } catch {
      throw new UnauthorizedException('Oturum gerekli')
    }
    // Tokens of deleted accounts must stop working.
    const rows = await this.db.query('SELECT 1 FROM users WHERE id = ?', [userId])
    if (!rows.length) throw new UnauthorizedException('Oturum gerekli')
    req.userId = userId
    return true
  }
}
