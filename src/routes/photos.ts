import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'
import { uploadPhoto, deleteFile, getKeyFromUrl } from '../services/storage'
import { MultipartFile } from '@fastify/multipart'

function formatPhoto(photo: {
  id: string; uid: string; url: string; latitude: number | null; longitude: number | null;
  takenAt: Date | null; uploadedAt: Date; hasGps: boolean; folderId: string | null
}) {
  return {
    id: photo.id,
    uid: photo.uid,
    url: photo.url,
    latitude: photo.latitude,
    longitude: photo.longitude,
    takenAt: photo.takenAt?.toISOString(),
    uploadedAt: photo.uploadedAt.toISOString(),
    hasGps: photo.hasGps,
    folderId: photo.folderId,
  }
}

export async function photoRoutes(fastify: FastifyInstance) {
  // GET /api/v1/photos?folderId=xxx
  fastify.get('/api/v1/photos', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { folderId, uid } = req.query as { folderId?: string; uid?: string }
    const userId = (req as AuthenticatedRequest).userId

    const photos = await prisma.photo.findMany({
      where: {
        ...(folderId ? { folderId } : {}),
        ...(uid ? { uid } : { uid: userId }),
      },
      orderBy: { uploadedAt: 'desc' },
    })

    return reply.send({ photos: photos.map(formatPhoto) })
  })

  // POST /api/v1/photos - create photo record (URL already uploaded)
  fastify.post('/api/v1/photos', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const data = req.body as {
      url: string; latitude?: number; longitude?: number;
      takenAt?: string; hasGps?: boolean; folderId?: string
    }

    const photo = await prisma.photo.create({
      data: {
        uid: userId,
        url: data.url,
        latitude: data.latitude,
        longitude: data.longitude,
        takenAt: data.takenAt ? new Date(data.takenAt) : undefined,
        hasGps: data.hasGps ?? false,
        folderId: data.folderId,
      },
    })

    // Update folder photoCount if folderId given
    if (data.folderId) {
      await prisma.folder.update({
        where: { id: data.folderId },
        data: { photoCount: { increment: 1 } },
      })
    }

    return reply.status(201).send(formatPhoto(photo))
  })

  // DELETE /api/v1/photos/:id
  fastify.delete('/api/v1/photos/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const photo = await prisma.photo.findUnique({ where: { id } })
    if (!photo) return reply.status(404).send({ error: 'Photo not found' })
    if (photo.uid !== userId) return reply.status(403).send({ error: 'Forbidden' })

    // Delete from R2 if it's a real URL (not base64)
    if (photo.url.startsWith('http')) {
      try {
        await deleteFile(getKeyFromUrl(photo.url))
      } catch (e) {
        // Ignore storage errors, still delete the record
      }
    }

    await prisma.photo.delete({ where: { id } })

    // Decrement folder photoCount
    if (photo.folderId) {
      await prisma.folder.update({
        where: { id: photo.folderId },
        data: { photoCount: { decrement: 1 } },
      })
    }

    return reply.status(204).send()
  })
}
