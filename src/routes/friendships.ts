import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

export async function friendshipRoutes(fastify: FastifyInstance) {
  // GET /api/v1/friendships - get all friendships
  fastify.get('/api/v1/friendships', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, displayName: true, avatarUrl: true, email: true } },
        addressee: { select: { id: true, displayName: true, avatarUrl: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({
      friendships: friendships.map(f => ({
        id: f.id,
        requesterId: f.requesterId,
        addresseeId: f.addresseeId,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt?.toISOString(),
        requester: f.requester,
        addressee: f.addressee,
      }))
    })
  })

  // GET /api/v1/friendships/status?userId=xxx
  fastify.get('/api/v1/friendships/status', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const currentUserId = (req as AuthenticatedRequest).userId
    const { userId } = req.query as { userId: string }

    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: currentUserId, addresseeId: userId },
          { requesterId: userId, addresseeId: currentUserId },
        ],
      },
    })

    return reply.send({ friendship: friendship || null })
  })

  // POST /api/v1/friendships - send friend request
  fastify.post('/api/v1/friendships', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { addresseeId } = req.body as { addresseeId: string }

    if (userId === addresseeId) return reply.status(400).send({ error: 'Không thể kết bạn với chính mình' })

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId },
          { requesterId: addresseeId, addresseeId: userId },
        ],
      },
    })

    if (existing) return reply.status(409).send({ error: 'Đã có quan hệ bạn bè hoặc đang chờ', friendship: existing })

    const friendship = await prisma.friendship.create({
      data: { requesterId: userId, addresseeId, status: 'pending' },
    })

    // Create notification for addressee
    await prisma.notification.create({
      data: {
        recipientId: addresseeId,
        actorId: userId,
        type: 'friend_request',
        entityId: friendship.id,
      },
    })

    return reply.status(201).send({ friendship })
  })

  // PUT /api/v1/friendships/:id - accept/decline
  fastify.put('/api/v1/friendships/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }
    const { status } = req.body as { status: 'accepted' | 'blocked' | 'rejected' }

    const friendship = await prisma.friendship.findUnique({ where: { id } })
    if (!friendship) return reply.status(404).send({ error: 'Not found' })

    // Only addressee can accept/decline
    if (friendship.addresseeId !== userId && status !== 'blocked') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    if (status === 'rejected') {
      await prisma.friendship.delete({ where: { id } })
      return reply.send({ deleted: true })
    }

    const updated = await prisma.friendship.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    })

    if (status === 'accepted') {
      // Notify requester
      await prisma.notification.create({
        data: {
          recipientId: friendship.requesterId,
          actorId: userId,
          type: 'friend_accepted',
          entityId: id,
        },
      })
    }

    return reply.send({ friendship: updated })
  })

  // DELETE /api/v1/friendships/:id - unfriend
  fastify.delete('/api/v1/friendships/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const friendship = await prisma.friendship.findUnique({ where: { id } })
    if (!friendship) return reply.status(404).send({ error: 'Not found' })

    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    await prisma.friendship.delete({ where: { id } })
    return reply.status(204).send()
  })
}
