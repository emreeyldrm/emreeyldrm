import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { Repository } from 'typeorm'
import { User } from '../database/entities'
import { now } from '../common/util'
import { LoginDto, RegisterDto } from './auth.dto'

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10

@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private users: Repository<User>, private jwt: JwtService) {}

  private async session(u: User) {
    const token = await this.jwt.signAsync({ sub: String(u.id) })
    return { token, user: { id: u.id, handle: u.handle, email: u.email } }
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase()
    const clash = await this.users.findOne({ where: [{ email }, { handle: dto.handle }] })
    if (clash) throw new ConflictException(clash.email === email ? 'E-posta zaten kayıtlı' : 'Bu kullanıcı adı alınmış')
    const user = await this.users.save(this.users.create({
      email, handle: dto.handle, passwordHash: await bcrypt.hash(dto.password, ROUNDS), createdAt: now(),
    }))
    return this.session(user)
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ where: { email: dto.email.trim().toLowerCase() } })
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('E-posta veya parola hatalı')
    return this.session(user)
  }
}
