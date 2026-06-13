import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'
import { uploadPhoto, uploadAvatar, uploadCover } from '../services/storage'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFile, unlink } from 'fs/promises'

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function uploadRoutes(fastify: FastifyInstance) {
  // POST /api/v1/upload/photo
  fastify.post('/api/v1/upload/photo', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await streamToBuffer(data.file)
    const url = await uploadPhoto(buffer, userId, data.filename)

    return reply.send({ url })
  })

  // POST /api/v1/upload/avatar
  fastify.post('/api/v1/upload/avatar', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await streamToBuffer(data.file)
    const url = await uploadAvatar(buffer, userId)

    // Update user's avatarUrl
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
    })

    return reply.send({ url })
  })

  // POST /api/v1/upload/cover
  fastify.post('/api/v1/upload/cover', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await streamToBuffer(data.file)
    const url = await uploadCover(buffer, userId)

    // Update user's coverUrl
    await prisma.user.update({
      where: { id: userId },
      data: { coverUrl: url },
    })

    return reply.send({ url })
  })
}
