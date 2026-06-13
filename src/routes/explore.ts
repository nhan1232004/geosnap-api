import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate'
import { prisma } from '../lib/prisma'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function exploreRoutes(fastify: FastifyInstance) {
  // GET /api/v1/explore/folders
  fastify.get('/api/v1/explore/folders', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = '12', orderBy = 'photoCount', search } = req.query as {
      limit?: string; orderBy?: string; search?: string
    }

    const folders = await prisma.folder.findMany({
      where: {
        visibility: 'public',
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { country: { contains: search, mode: 'insensitive' } },
          ]
        } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: orderBy === 'photoCount' ? { photoCount: 'desc' } : { createdAt: 'desc' },
      take: parseInt(limit),
    })

    return reply.send({
      folders: folders.map(f => ({
        id: f.id,
        uid: f.uid,
        name: f.name,
        centerLat: f.centerLat,
        centerLng: f.centerLng,
        photoCount: f.photoCount,
        coverPhotoUrl: f.coverPhotoUrl,
        country: f.country,
        city: f.city,
        visibility: f.visibility,
        createdAt: f.createdAt.toISOString(),
        user: f.user,
      }))
    })
  })

  // GET /api/v1/explore/photos - public photos
  fastify.get('/api/v1/explore/photos', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = '24', cursor } = req.query as { limit?: string; cursor?: string }

    // Get photos from public folders
    const publicFolders = await prisma.folder.findMany({
      where: { visibility: 'public' },
      select: { id: true },
    })
    const folderIds = publicFolders.map(f => f.id)

    const photos = await prisma.photo.findMany({
      where: {
        folderId: { in: folderIds },
        ...(cursor ? { uploadedAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { uploadedAt: 'desc' },
      take: parseInt(limit),
    })

    const nextCursor = photos.length === parseInt(limit)
      ? photos[photos.length - 1].uploadedAt.toISOString()
      : null

    return reply.send({
      photos: photos.map(p => ({
        id: p.id,
        uid: p.uid,
        url: p.url,
        uploadedAt: p.uploadedAt.toISOString(),
        hasGps: p.hasGps,
        folder: p.folder,
        user: p.user,
      })),
      nextCursor,
    })
  })
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard/stats
  fastify.get('/api/v1/dashboard/stats', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as AuthenticatedRequest).userId

    const [photos, folders, friendCount] = await Promise.all([
      prisma.photo.findMany({
        where: { uid: userId },
        select: { id: true, uploadedAt: true, latitude: true, longitude: true, takenAt: true },
      }),
      prisma.folder.findMany({
        where: { uid: userId },
        select: {
          id: true,
          name: true,
          photoCount: true,
          coverPhotoUrl: true,
          country: true,
          city: true,
          centerLat: true,
          centerLng: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.friendship.count({
        where: {
          status: 'accepted',
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
      }),
    ])

    // Calculate stats
    const countries = [...new Set(folders.map(f => f.country).filter(Boolean))]
    const topFolders = [...folders].sort((a, b) => b.photoCount - a.photoCount).slice(0, 5)

    // Farthest location calculation from home (earliest folder)
    let farthestLocation = '—'
    if (folders.length >= 2) {
      const home = folders[folders.length - 1] // earliest
      let maxDist = 0
      let farthestName = ''
      for (const f of folders) {
        if (f.id === home.id) continue
        const dist = haversineKm(home.centerLat, home.centerLng, f.centerLat, f.centerLng)
        if (dist > maxDist) {
          maxDist = dist
          farthestName = f.name
        }
      }
      if (maxDist > 0) {
        farthestLocation = `${farthestName} · ${Math.round(maxDist).toLocaleString()} km`
      }
    }

    // Monthly photo counts (last 12 months)
    const now = new Date()
    const monthlyData: { month: string; count: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const nextDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const count = photos.filter(p => {
        const d = new Date(p.uploadedAt)
        return d >= date && d < nextDate
      }).length
      monthlyData.push({
        month: date.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' }),
        count,
      })
    }

    // Most active month
    let mostActiveMonth = '—'
    if (photos.length > 0) {
      const counts: Record<string, number> = {}
      photos.forEach(p => {
        const d = new Date(p.uploadedAt)
        const key = `${d.getMonth() + 1}/${d.getFullYear()}`
        counts[key] = (counts[key] || 0) + 1
      })
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      if (best) {
        const [monthStr] = best
        const [mm, yyyy] = monthStr.split('/')
        const d = new Date(Number(yyyy), Number(mm) - 1)
        mostActiveMonth = d.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
      }
    }

    // Activity heatmap (last 52 weeks)
    const heatmap: Record<string, number> = {}
    photos.forEach(p => {
      const day = new Date(p.uploadedAt).toISOString().split('T')[0]
      heatmap[day] = (heatmap[day] || 0) + 1
    })

    return reply.send({
      stats: {
        totalPhotos: photos.length,
        totalLocations: folders.length,
        totalCountries: countries.length,
        totalFriends: friendCount,
        countries,
        farthestLocation,
        mostActiveMonth,
      },
      topFolders,
      monthlyData,
      heatmap,
      timeline: folders.slice(0, 20),
    })
  })
}
