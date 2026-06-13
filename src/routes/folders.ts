import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

function formatFolder(folder: {
  id: string; uid: string; name: string; centerLat: number; centerLng: number;
  photoCount: number; coverPhotoUrl: string | null; country: string | null; city: string | null;
  district: string | null; street: string | null; firstVisitedAt: Date | null;
  lastVisitedAt: Date | null; visibility: string; description: string | null;
  reactions: unknown; createdAt: Date; updatedAt: Date
}) {
  return {
    id: folder.id,
    uid: folder.uid,
    name: folder.name,
    centerLat: folder.centerLat,
    centerLng: folder.centerLng,
    photoCount: folder.photoCount,
    coverPhotoUrl: folder.coverPhotoUrl,
    country: folder.country,
    city: folder.city,
    district: folder.district,
    street: folder.street,
    firstVisitedAt: folder.firstVisitedAt?.toISOString(),
    lastVisitedAt: folder.lastVisitedAt?.toISOString(),
    visibility: folder.visibility,
    description: folder.description,
    reactions: folder.reactions,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}

export async function folderRoutes(fastify: FastifyInstance) {
  // GET /api/v1/folders - my folders (paginated)
  fastify.get('/api/v1/folders', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { limit = '20', cursor } = req.query as { limit?: string; cursor?: string }

    const folders = await prisma.folder.findMany({
      where: { uid: userId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const nextCursor = folders.length === parseInt(limit) ? folders[folders.length - 1].id : null
    return reply.send({ folders: folders.map(formatFolder), nextCursor })
  })

  // GET /api/v1/folders/friends - friends' folders for map
  fastify.get('/api/v1/folders/friends', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    })

    const friendIds = friendships.map(f =>
      f.requesterId === userId ? f.addresseeId : f.requesterId
    )

    if (friendIds.length === 0) return reply.send({ folders: [] })

    const folders = await prisma.folder.findMany({
      where: {
        uid: { in: friendIds },
        visibility: { in: ['friends', 'public'] },
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ folders: folders.map(f => ({ ...formatFolder(f), user: f.user })) })
  })

  // GET /api/v1/folders/public - public folders for explore
  fastify.get('/api/v1/folders/public', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = '12', orderBy = 'photoCount' } = req.query as { limit?: string; orderBy?: string }

    const folders = await prisma.folder.findMany({
      where: { visibility: 'public' },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: orderBy === 'photoCount'
        ? { photoCount: 'desc' }
        : { createdAt: 'desc' },
      take: parseInt(limit),
    })

    return reply.send({ folders: folders.map(f => ({ ...formatFolder(f), user: f.user })) })
  })

  // GET /api/v1/folders/:id
  fastify.get('/api/v1/folders/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const folder = await prisma.folder.findUnique({
      where: { id },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    })

    if (!folder) return reply.status(404).send({ error: 'Folder not found' })

    // Check visibility
    if (folder.uid !== userId) {
      if (folder.visibility === 'private') return reply.status(403).send({ error: 'Forbidden' })
      if (folder.visibility === 'friends') {
        const friendship = await prisma.friendship.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { requesterId: userId, addresseeId: folder.uid },
              { requesterId: folder.uid, addresseeId: userId },
            ],
          },
        })
        if (!friendship) return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    return reply.send({ ...formatFolder(folder), user: folder.user })
  })

  // POST /api/v1/folders
  fastify.post('/api/v1/folders', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const data = req.body as {
      name: string; centerLat: number; centerLng: number;
      country?: string; city?: string; district?: string; street?: string;
      visibility?: string; description?: string; coverPhotoUrl?: string;
      firstVisitedAt?: string; lastVisitedAt?: string
    }

    const folder = await prisma.folder.create({
      data: {
        uid: userId,
        name: data.name,
        centerLat: data.centerLat,
        centerLng: data.centerLng,
        country: data.country,
        city: data.city,
        district: data.district,
        street: data.street,
        visibility: data.visibility || 'private',
        description: data.description,
        coverPhotoUrl: data.coverPhotoUrl,
        firstVisitedAt: data.firstVisitedAt ? new Date(data.firstVisitedAt) : undefined,
        lastVisitedAt: data.lastVisitedAt ? new Date(data.lastVisitedAt) : undefined,
      },
    })

    return reply.status(201).send(formatFolder(folder))
  })

  // PUT /api/v1/folders/:id
  fastify.put('/api/v1/folders/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const folder = await prisma.folder.findUnique({ where: { id } })
    if (!folder) return reply.status(404).send({ error: 'Folder not found' })
    if (folder.uid !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const data = req.body as {
      name?: string; visibility?: string; description?: string;
      coverPhotoUrl?: string; photoCount?: number;
      centerLat?: number; centerLng?: number;
      reactions?: Record<string, string>;
      lastVisitedAt?: string
    }

    const updated = await prisma.folder.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.visibility !== undefined && { visibility: data.visibility }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.coverPhotoUrl !== undefined && { coverPhotoUrl: data.coverPhotoUrl }),
        ...(data.photoCount !== undefined && { photoCount: data.photoCount }),
        ...(data.centerLat !== undefined && { centerLat: data.centerLat }),
        ...(data.centerLng !== undefined && { centerLng: data.centerLng }),
        ...(data.reactions !== undefined && { reactions: data.reactions }),
        ...(data.lastVisitedAt !== undefined && { lastVisitedAt: new Date(data.lastVisitedAt) }),
      },
    })

    return reply.send(formatFolder(updated))
  })

  // DELETE /api/v1/folders/:id
  fastify.delete('/api/v1/folders/:id', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId
    const { id } = req.params as { id: string }

    const folder = await prisma.folder.findUnique({ where: { id } })
    if (!folder) return reply.status(404).send({ error: 'Folder not found' })
    if (folder.uid !== userId) return reply.status(403).send({ error: 'Forbidden' })

    // Cascade delete handled by Prisma/PostgreSQL
    await prisma.folder.delete({ where: { id } })
    return reply.status(204).send()
  })

  // GET /api/v1/folders/user/:userId - folders of a specific user
  fastify.get('/api/v1/folders/user/:userId', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const currentUserId = (req as AuthenticatedRequest).userId
    const { userId } = req.params as { userId: string }

    let visibilityFilter: string[] = ['public']

    if (currentUserId === userId) {
      visibilityFilter = ['private', 'friends', 'public']
    } else {
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: currentUserId, addresseeId: userId },
            { requesterId: userId, addresseeId: currentUserId },
          ],
        },
      })
      if (friendship) visibilityFilter = ['friends', 'public']
    }

    const folders = await prisma.folder.findMany({
      where: { uid: userId, visibility: { in: visibilityFilter } },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ folders: folders.map(formatFolder) })
  })
}
