import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

export interface AuthenticatedRequest extends FastifyRequest {
  userId: string
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Không có token xác thực' })
  }

  const token = authHeader.slice(7)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    ;(req as AuthenticatedRequest).userId = decoded.userId
  } catch {
    return reply.status(401).send({ error: 'Token không hợp lệ hoặc đã hết hạn' })
  }
}
