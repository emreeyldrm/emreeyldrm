import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse()
    if (exception instanceof HttpException) {
      const body = exception.getResponse()
      let message: string = exception.message
      if (typeof body === 'string') message = body
      else if (body && typeof body === 'object') {
        const m = (body as any).message
        message = Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : exception.message
      }
      res.status(exception.getStatus()).json({ error: message })
      return
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception))
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' })
  }
}
