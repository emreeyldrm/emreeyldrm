import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

export class RatingDto {
  @IsInt() @Min(1) @Max(5) stars: number
}

export class CreateCommentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @Length(1, 1000) body: string
  @IsOptional() @IsIn(['private', 'friends', 'public']) visibility?: 'private' | 'friends' | 'public'
  @IsOptional() @IsInt() parentId?: number
}
