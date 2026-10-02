import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/** Id of the authenticated user (set by AuthGuard). */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): number =>
  ctx.switchToHttp().getRequest().userId)
