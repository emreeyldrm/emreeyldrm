import { Controller, Get, Headers, HttpCode, HttpException, NotFoundException, Param, Post, Req, Res } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import { DataSource } from 'typeorm'
import { UserId } from '../common/current-user.decorator'
import { Public } from '../common/public.decorator'
import { q, requestNow } from '../common/util'
import { TEST_NOW_HEADER } from '../discover/discover-core'
import { Media } from '../database/entities'
import {
  checkUpload, DetailsError, isMediaId, MEDIA_CACHE_CONTROL, MEDIA_MAX_BYTES, mediaIdFromBytes, mediaUrl,
} from '../lists/details-core'

/**
 * Reads the raw request body (after the auth guard, so an anonymous upload is 401 before anything is read).
 * Express' JSON/urlencoded parsers skip image content types, so the stream is still unread here.
 * Past the limit the rest is drained (not buffered) so the client gets a clean 413.
 */
function readRaw(req: Request, max: number): Promise<{ buf: Buffer; size: number }> {
  if (Buffer.isBuffer((req as any).body)) return Promise.resolve({ buf: (req as any).body, size: (req as any).body.length })
  if (req.readableEnded) return Promise.resolve({ buf: Buffer.alloc(0), size: 0 })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => { size += c.length; if (size <= max) chunks.push(c) })
    req.on('end', () => resolve({ buf: Buffer.concat(chunks), size }))
    req.on('error', reject)
  })
}

/** Reads off an unwanted body before answering, so the client is not cut off mid-upload. */
function drain(req: Request): Promise<void> {
  if (req.readableEnded) return Promise.resolve()
  return new Promise((resolve) => { req.on('end', resolve); req.on('error', () => resolve()); req.resume() })
}

const toHttp = (e: unknown) => (e instanceof DetailsError ? new HttpException(e.message, e.status) : e)

@Controller('media')
export class MediaController {
  constructor(private db: DataSource) {}

  /**
   * POST /media: raw image body (JPEG/PNG/WebP, ≤ 5 MB) -> 201 {id, url}.
   * created_at follows the request clock (X-Test-Now only under E2E_TEST_HOOKS=1), so AC-MED-1 tests can upload "old" media.
   */
  @Post()
  @HttpCode(201)
  async upload(@UserId() me: number, @Req() req: Request, @Headers(TEST_NOW_HEADER) testNow?: string) {
    const type = req.headers['content-type']
    const declared = Number(req.headers['content-length'] ?? 0)
    try {
      checkUpload(type, Number.isFinite(declared) && declared > 0 ? declared : 1) // type and declared size first
    } catch (e) {
      await drain(req)
      throw toHttp(e)
    }
    const { buf, size } = await readRaw(req, MEDIA_MAX_BYTES)
    let contentType: string
    try { contentType = checkUpload(type, size) } catch (e) { throw toHttp(e) }
    const id = mediaIdFromBytes(randomBytes(16))
    await this.db.getRepository(Media).insert({ id, ownerId: me, contentType, size, data: buf, createdAt: requestNow(testNow).toISOString() })
    return { id, url: mediaUrl(id) }
  }

  /** GET /media/:id: public (image tags cannot send headers; ids are unguessable), cached forever. */
  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response) {
    if (!isMediaId(id)) throw new NotFoundException('Bulunamadı')
    const [m] = await q(this.db, 'SELECT content_type AS contentType, data FROM media WHERE id = ?', [id])
    if (!m) throw new NotFoundException('Bulunamadı')
    res.setHeader('Content-Type', m.contentType)
    res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL)
    const data = Buffer.from(m.data)
    res.setHeader('Content-Length', String(data.length))
    res.end(data)
  }
}
