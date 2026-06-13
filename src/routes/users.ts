import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

function formatUser(user: {
  id: string; email: string; displayName: string | null; avatarUrl: string | null;
  coverUrl: string | null; role: string; inviteCode: string; bio: string | null; createdAt: Date
}) {
  return {
    uid: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    role: user.role,
    inviteCode: user.inviteCode,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function userRoutes(fastify: FastifyInstance) {
  // GET /api/v1/users/me
  fastify.get('/api/v1/users/me', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send(formatUser(user))
  })

  // GET /api/v1/users/:id
  fastify.get('/api/v1/users/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send(formatUser(user))
  })

  // GET /api/v1/users?inviteCode=xxx (Public lookup for invite page)
  fastify.get('/api/v1/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const { inviteCode } = req.query as { inviteCode?: string }
    if (!inviteCode) return reply.status(400).send({ error: 'inviteCode is required' })
    
    const user = await prisma.user.findUnique({ where: { inviteCode } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send(formatUser(user))
  })

  // PUT /api/v1/users/me
  fastify.put('/api/v1/users/me', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { displayName, bio, avatarUrl, coverUrl, pushToken } = req.body as {
      displayName?: string; bio?: string; avatarUrl?: string; coverUrl?: string; pushToken?: string
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(bio !== undefined && { bio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(coverUrl !== undefined && { coverUrl }),
        ...(pushToken !== undefined && { pushToken }),
      },
    })

    return reply.send(formatUser(user))
  })
}
