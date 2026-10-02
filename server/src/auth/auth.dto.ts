import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail() email: string
  @IsString() @MinLength(8) password: string
  @IsString() @Matches(/^[a-z0-9_]{3,20}$/, { message: 'handle must match ^[a-z0-9_]{3,20}$' }) handle: string
}

export class LoginDto {
  @IsString() @IsNotEmpty() email: string
  @IsString() @IsNotEmpty() password: string
}
