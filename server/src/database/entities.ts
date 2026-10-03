import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number
  @Column({ type: 'text', unique: true }) email: string
  @Column({ name: 'password_hash', type: 'text' }) passwordHash: string
  @Column({ type: 'text', unique: true }) handle: string
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

@Entity('places')
@Unique(['provider', 'providerId'])
export class Place {
  @PrimaryGeneratedColumn() id: number
  @Column({ type: 'text' }) provider: string
  @Column({ name: 'provider_id', type: 'text' }) providerId: string
  @Column({ type: 'text' }) name: string
  @Column({ type: 'real', nullable: true }) lat: number | null
  @Column({ type: 'real', nullable: true }) lon: number | null
  @Column({ type: 'text', default: 'other' }) category: string
  @Index() @Column({ type: 'text', nullable: true }) city: string | null
}

@Entity('lists')
export class List {
  @PrimaryGeneratedColumn() id: number
  @Index() @Column({ name: 'owner_id', type: 'integer' }) ownerId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'owner_id' }) owner: User
  @Column({ type: 'text' }) city: string
  @Column({ type: 'text' }) title: string
  @Column({ type: 'text', default: 'private' }) visibility: 'private' | 'public'
  @Column({ name: 'allow_copy', type: 'boolean', default: true }) allowCopy: boolean
  @Column({ name: 'allow_comments', type: 'boolean', default: true }) allowComments: boolean
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
  @Column({ name: 'updated_at', type: 'text' }) updatedAt: string
}

@Entity('list_items')
export class ListItem {
  @PrimaryColumn({ name: 'list_id', type: 'integer' }) listId: number
  @ManyToOne(() => List, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'list_id' }) list: List
  @PrimaryColumn({ name: 'place_id', type: 'integer' }) placeId: number
  @ManyToOne(() => Place, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'place_id' }) place: Place
  @Column({ type: 'text', default: 'other' }) category: string
  @Column({ type: 'text', default: '' }) note: string
  @Column({ type: 'integer', default: 0 }) position: number
  /** Validated JSON (details-core.ts), `{}` when empty. */
  @Column({ type: 'text', default: '{}' }) details: string
}

@Entity('ratings')
export class Rating {
  @PrimaryColumn({ name: 'place_id', type: 'integer' }) placeId: number
  @ManyToOne(() => Place, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'place_id' }) place: Place
  @PrimaryColumn({ name: 'user_id', type: 'integer' }) userId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User
  @Column({ type: 'integer' }) stars: number
  @Column({ name: 'updated_at', type: 'text' }) updatedAt: string
}

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn() id: number
  @Index() @Column({ name: 'place_id', type: 'integer' }) placeId: number
  @ManyToOne(() => Place, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'place_id' }) place: Place
  @Column({ name: 'user_id', type: 'integer' }) userId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User
  @Column({ name: 'parent_id', type: 'integer', nullable: true }) parentId: number | null
  @ManyToOne(() => Comment, { onDelete: 'CASCADE', nullable: true }) @JoinColumn({ name: 'parent_id' }) parent: Comment
  @Column({ type: 'text' }) body: string
  @Column({ type: 'text', default: 'public' }) visibility: 'private' | 'friends' | 'public'
  @Column({ type: 'boolean', default: false }) hidden: boolean
  /** JSON array of media ids, `[]` when none. */
  @Column({ type: 'text', default: '[]' }) photos: string
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

@Entity('follows')
export class Follow {
  @PrimaryColumn({ name: 'follower_id', type: 'integer' }) followerId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'follower_id' }) follower: User
  @Index() @PrimaryColumn({ name: 'followee_id', type: 'integer' }) followeeId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'followee_id' }) followee: User
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

@Entity('blocks')
export class Block {
  @PrimaryColumn({ name: 'blocker_id', type: 'integer' }) blockerId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'blocker_id' }) blocker: User
  @PrimaryColumn({ name: 'blocked_id', type: 'integer' }) blockedId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'blocked_id' }) blocked: User
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn() id: number
  @Column({ name: 'reporter_id', type: 'integer' }) reporterId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'reporter_id' }) reporter: User
  @Column({ name: 'target_type', type: 'text' }) targetType: 'comment' | 'list' | 'user'
  @Column({ name: 'target_id', type: 'integer' }) targetId: number
  @Column({ type: 'text' }) reason: string
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

/** Uploaded images (POST /media). The bytes live here in NestJS; the Worker keeps them in R2. */
@Entity('media')
export class Media {
  @PrimaryColumn({ type: 'text' }) id: string
  @Index() @Column({ name: 'owner_id', type: 'integer' }) ownerId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'owner_id' }) owner: User
  @Column({ name: 'content_type', type: 'text' }) contentType: string
  @Column({ type: 'integer' }) size: number
  @Column({ type: 'blob', select: false }) data: Buffer
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

/**
 * Keşfet sinyalleri (TRD): görüntüleme ve kaydetme. Bileşik birincil anahtar tekilleştirmeyi sağlar (INSERT OR IGNORE):
 * view = kişi + yer + gün (UTC), save = kişi + yer (day = ''). Worker: migrations/0005_place_events.sql.
 */
@Entity('place_events')
@Check(`kind IN ('view','save')`)
@Index('place_events_place_created', ['placeId', 'createdAt'])
export class PlaceEvent {
  @PrimaryColumn({ name: 'place_id', type: 'integer' }) placeId: number
  @ManyToOne(() => Place, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'place_id' }) place: Place
  @Index() @PrimaryColumn({ name: 'user_id', type: 'integer' }) userId: number
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User
  @PrimaryColumn({ type: 'text' }) kind: 'view' | 'save'
  @PrimaryColumn({ type: 'text', default: '' }) day: string
  @Column({ name: 'created_at', type: 'text' }) createdAt: string
}

export const ENTITIES = [User, Place, List, ListItem, Rating, Comment, Follow, Block, Report, Media, PlaceEvent]
