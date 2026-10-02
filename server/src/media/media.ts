import { BadRequestException } from '@nestjs/common'
import { q } from '../common/util'

/** 400 unless every id is a media item uploaded by `me` (details photos, comment photos). */
export async function requireOwnMedia(
  db: { query(sql: string, params?: any[]): Promise<any> }, me: number, ids: string[],
) {
  if (!ids.length) return
  const rows = await q(db, `SELECT id FROM media WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [me, ...ids])
  if (rows.length !== ids.length) throw new BadRequestException('Fotoğraf bulunamadı ya da sana ait değil')
}
