import { Allow, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

export class RatingDto {
  @IsInt() @Min(1) @Max(5) stars: number
}

export class CreateCommentDto {
  /** Text (0-1000 after trim) and photos (≤ 4 own media ids) are checked by details-core.ts (parseCommentInput). */
  @Allow() body?: unknown
  @Allow() photos?: unknown
  @IsOptional() @IsIn(['private', 'friends', 'public']) visibility?: 'private' | 'friends' | 'public'
  @IsOptional() @IsInt() parentId?: number
}
