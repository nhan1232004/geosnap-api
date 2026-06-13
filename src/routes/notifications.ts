import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

export async function notificationRoutes(fastify: FastifyInstance) {
  // GET /api/v1/notifications
  fastify.get('/api/v1/notifications', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const notifications = await prisma.notification.findMany({
      where: { recipientId: userId },
      include: {
        actor: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return reply.send({
      notifications: notifications.map(n => ({
        id: n.id,
        recipientId: n.recipientId,
        actorId: n.actorId,
        type: n.type,
        entityId: n.entityId,
        entityName: n.entityName,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
        actor: n.actor,
      }))
    })
  })

  // PUT /api/v1/notifications/:id - mark as read
  fastify.put('/api/v1/notifications/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const notif = await prisma.notification.findUnique({ where: { id } })
    if (!notif || notif.recipientId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return reply.send({ notification: updated })
  })

  // PUT /api/v1/notifications/read-all - mark all as read
  fastify.put('/api/v1/notifications/read-all', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    })

    return reply.send({ success: true })
  })
}

export async function commentRoutes(fastify: FastifyInstance) {
  // GET /api/v1/comments
  fastify.get('/api/v1/comments', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { folderId, postId } = req.query as { folderId?: string; postId?: string }

    const comments = await prisma.comment.findMany({
      where: {
        ...(folderId ? { folderId } : {}),
        ...(postId ? { postId } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true, email: true, role: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send({
      comments: comments.map(c => ({
        id: c.id,
        uid: c.uid,
        folderId: c.folderId,
        postId: c.postId,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        userProfile: c.user ? {
          uid: c.user.id,
          displayName: c.user.displayName,
          avatarUrl: c.user.avatarUrl,
          email: c.user.email,
          role: c.user.role,
          createdAt: c.user.createdAt.toISOString(),
        } : null,
      }))
    })
  })

  // POST /api/v1/comments
  fastify.post('/api/v1/comments', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { folderId, postId, content } = req.body as {
      folderId?: string; postId?: string; content: string
    }

    if (!content || content.trim().length === 0) return reply.status(400).send({ error: 'Nội dung không được trống' })
    if (content.length > 500) return reply.status(400).send({ error: 'Tối đa 500 ký tự' })
    if (!folderId && !postId) return reply.status(400).send({ error: 'folderId hoặc postId là bắt buộc' })

    const comment = await prisma.comment.create({
      data: { uid: userId, folderId, postId, content: content.trim() },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true, email: true, role: true, createdAt: true } },
      },
    })

    // Increment commentCount if postId
    if (postId) {
      await prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      })
    }

    return reply.status(201).send({
      id: comment.id,
      uid: comment.uid,
      folderId: comment.folderId,
      postId: comment.postId,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      userProfile: comment.user ? {
        uid: comment.user.id,
        displayName: comment.user.displayName,
        avatarUrl: comment.user.avatarUrl,
        email: comment.user.email,
        role: comment.user.role,
        createdAt: comment.user.createdAt.toISOString(),
      } : null,
    })
  })

  // DELETE /api/v1/comments/:id
  fastify.delete('/api/v1/comments/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const comment = await prisma.comment.findUnique({ where: { id } })
    if (!comment) return reply.status(404).send({ error: 'Comment not found' })
    if (comment.uid !== userId) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.comment.delete({ where: { id } })

    if (comment.postId) {
      await prisma.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      })
    }

    return reply.status(204).send()
  })
}
