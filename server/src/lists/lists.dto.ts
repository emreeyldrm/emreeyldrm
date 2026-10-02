import { Type } from 'class-transformer'
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, ValidateNested,
} from 'class-validator'

export class CreateListDto {
  @IsString() @IsNotEmpty() @MaxLength(100) city: string
  @IsString() @IsNotEmpty() @MaxLength(200) title: string
  @IsOptional() @IsIn(['private', 'public']) visibility?: 'private' | 'public'
}

export class UpdateListDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string
  @IsOptional() @IsIn(['private', 'public']) visibility?: 'private' | 'public'
  @IsOptional() @IsBoolean() allowCopy?: boolean
  @IsOptional() @IsBoolean() allowComments?: boolean
}

export class ListItemDto {
  @IsString() @IsNotEmpty() provider: string
  @IsString() @IsNotEmpty() providerId: string
  @IsString() @IsNotEmpty() name: string
  @IsOptional() @IsNumber() lat?: number
  @IsOptional() @IsNumber() lon?: number
  @IsOptional() @IsString() category?: string
  @IsOptional() @IsString() city?: string
  @IsOptional() @IsString() note?: string
}

export class ReplaceItemsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ListItemDto)
  items: ListItemDto[]
}
