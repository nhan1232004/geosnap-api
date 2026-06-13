import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

function formatPost(post: {
  id: string; uid: string; type: string; content: string | null; imageUrls: string[];
  reactions: unknown; commentCount: number; shareCount: number; visibility: string;
  expiresAt: Date | null; createdAt: Date; updatedAt: Date;
  user?: { id: string; displayName: string | null; avatarUrl: string | null } | null
}) {
  return {
    id: post.id,
    uid: post.uid,
    type: post.type,
    content: post.content,
    imageUrls: post.imageUrls,
    reactions: post.reactions,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    visibility: post.visibility,
    expiresAt: post.expiresAt?.toISOString(),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    user: post.user ? {
      uid: post.user.id,
      displayName: post.user.displayName,
      avatarUrl: post.user.avatarUrl,
    } : undefined,
  }
}

export async function postRoutes(fastify: FastifyInstance) {
  // GET /api/v1/posts/feed - aggregated friend feed
  fastify.get('/api/v1/posts/feed', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { limit = '20', cursor } = req.query as { limit?: string; cursor?: string }

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    })
    const friendIds = [
      userId,
      ...friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId)
    ]

    const posts = await prisma.post.findMany({
      where: {
        uid: { in: friendIds },
        OR: [
          { type: 'post' },
          // Include stories only if not expired
          { type: 'story', expiresAt: { gt: new Date() } },
        ],
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    })

    const nextCursor = posts.length === parseInt(limit)
      ? posts[posts.length - 1].createdAt.toISOString()
      : null

    return reply.send({ posts: posts.map(formatPost), nextCursor })
  })

  // GET /api/v1/posts/stories - active stories
  fastify.get('/api/v1/posts/stories', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    })
    const friendIds = [
      userId,
      ...friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId)
    ]

    const stories = await prisma.post.findMany({
      where: {
        uid: { in: friendIds },
        type: 'story',
        expiresAt: { gt: new Date() },
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ stories: stories.map(formatPost) })
  })

  // POST /api/v1/posts
  fastify.post('/api/v1/posts', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const data = req.body as {
      type?: string; content?: string; imageUrls?: string[];
      visibility?: string; expiresAt?: string
    }

    const post = await prisma.post.create({
      data: {
        uid: userId,
        type: data.type || 'post',
        content: data.content,
        imageUrls: data.imageUrls || [],
        visibility: data.visibility || 'friends',
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    })

    return reply.status(201).send(formatPost(post))
  })

  // PUT /api/v1/posts/:id/react - add/remove reaction
  fastify.put('/api/v1/posts/:id/react', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }
    const { emoji } = req.body as { emoji: string | null }

    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return reply.status(404).send({ error: 'Post not found' })

    const reactions = (post.reactions as Record<string, string>) || {}
    if (emoji === null) {
      delete reactions[userId]
    } else {
      reactions[userId] = emoji
    }

    const updated = await prisma.post.update({
      where: { id },
      data: { reactions },
    })

    return reply.send({ reactions: updated.reactions })
  })

  // PUT /api/v1/posts/:id/share - increment share count
  fastify.put('/api/v1/posts/:id/share', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }

    const updated = await prisma.post.update({
      where: { id },
      data: { shareCount: { increment: 1 } },
    })

    return reply.send({ shareCount: updated.shareCount })
  })

  // DELETE /api/v1/posts/:id
  fastify.delete('/api/v1/posts/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return reply.status(404).send({ error: 'Post not found' })
    if (post.uid !== userId) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.post.delete({ where: { id } })
    return reply.status(204).send()
  })
}
