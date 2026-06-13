import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Server as SocketServer } from 'socket.io'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

function formatMessage(msg: {
  id: string; conversationId: string; senderId: string; recipientId: string;
  content: string; createdAt: Date;
  sender?: { id: string; displayName: string | null; avatarUrl: string | null } | null
}) {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
    sender: msg.sender ? {
      uid: msg.sender.id,
      displayName: msg.sender.displayName,
      avatarUrl: msg.sender.avatarUrl,
    } : undefined,
  }
}

export async function messageRoutes(fastify: FastifyInstance, io: SocketServer) {
  // GET /api/v1/messages/conversations - list all conversations
  fastify.get('/api/v1/messages/conversations', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    // Get all messages where user is involved, grouped by conversationId
    const lastMessages = await prisma.$queryRaw<{
      conversation_id: string;
      last_message: string;
      last_at: Date;
      other_user_id: string;
    }[]>`
      SELECT DISTINCT ON ("conversationId")
        "conversationId" as conversation_id,
        content as last_message,
        "createdAt" as last_at,
        CASE WHEN "senderId" = ${userId} THEN "recipientId" ELSE "senderId" END as other_user_id
      FROM messages
      WHERE "senderId" = ${userId} OR "recipientId" = ${userId}
      ORDER BY "conversationId", "createdAt" DESC
    `

    // Get other users' profiles
    const otherUserIds = lastMessages.map(m => m.other_user_id)
    const otherUsers = await prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: { id: true, displayName: true, avatarUrl: true, email: true },
    })
    const userMap = Object.fromEntries(otherUsers.map(u => [u.id, u]))

    return reply.send({
      conversations: lastMessages.map(m => ({
        conversationId: m.conversation_id,
        lastMessage: m.last_message,
        lastAt: m.last_at,
        otherUser: userMap[m.other_user_id] || null,
      }))
    })
  })

  // GET /api/v1/messages/:conversationId
  fastify.get('/api/v1/messages/:conversationId', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { conversationId } = req.params as { conversationId: string }

    // Verify user is part of this conversation
    const [uid1, uid2] = conversationId.split('_')
    if (uid1 !== userId && uid2 !== userId) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send({ messages: messages.map(formatMessage) })
  })

  // POST /api/v1/messages
  fastify.post('/api/v1/messages', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { recipientId, content } = req.body as { recipientId: string; content: string }

    if (!content || content.trim().length === 0) return reply.status(400).send({ error: 'Nội dung không được trống' })
    if (content.length > 1000) return reply.status(400).send({ error: 'Tối đa 1000 ký tự' })

    const conversationId = [userId, recipientId].sort().join('_')

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        recipientId,
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    })

    const formatted = formatMessage(message)

    // Emit via Socket.io to conversation room
    io.to(conversationId).emit('new-message', formatted)

    // Also notify the recipient's personal room for notification badge
    io.to(`user:${recipientId}`).emit('new-message-notification', {
      conversationId,
      senderName: message.sender?.displayName,
      preview: content.slice(0, 50),
    })

    return reply.status(201).send(formatted)
  })

  // DELETE /api/v1/messages/:id
  fastify.delete('/api/v1/messages/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const message = await prisma.message.findUnique({ where: { id } })
    if (!message) return reply.status(404).send({ error: 'Not found' })
    if (message.senderId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.message.delete({ where: { id } })
    return reply.status(204).send()
  })
}
