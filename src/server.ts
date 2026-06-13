import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import jwt from 'jsonwebtoken'

import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { folderRoutes } from './routes/folders'
import { photoRoutes } from './routes/photos'
import { uploadRoutes } from './routes/upload'
import { friendshipRoutes } from './routes/friendships'
import { notificationRoutes, commentRoutes } from './routes/notifications'
import { postRoutes } from './routes/posts'
import { messageRoutes } from './routes/messages'
import { exploreRoutes, dashboardRoutes } from './routes/explore'

const PORT = parseInt(process.env.PORT || '3001')
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const JWT_SECRET = process.env.JWT_SECRET!

async function main() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
    },
  })

  // Socket.io setup on fastify.server
  const io = new SocketServer(fastify.server, {
    cors: {
      origin: FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  // Socket.io authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('No token'))
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }
      socket.data.userId = decoded.userId
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  // Socket.io connection handler
  io.on('connection', (socket) => {
    const userId = socket.data.userId
    console.log(`[Socket] User ${userId} connected`)

    // Join user's personal room
    socket.join(`user:${userId}`)

    // Join a conversation room
    socket.on('join-conversation', (conversationId: string) => {
      // Verify user is part of this conversation
      const [uid1, uid2] = conversationId.split('_')
      if (uid1 === userId || uid2 === userId) {
        socket.join(conversationId)
        console.log(`[Socket] User ${userId} joined conversation ${conversationId}`)
      }
    })

    // Leave a conversation room
    socket.on('leave-conversation', (conversationId: string) => {
      socket.leave(conversationId)
    })

    socket.on('disconnect', () => {
      console.log(`[Socket] User ${userId} disconnected`)
    })
  })

  // Register Fastify plugins
  await fastify.register(cors, {
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  })

  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB max
    },
  })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Register all routes
  await fastify.register(authRoutes)
  await fastify.register(userRoutes)
  await fastify.register(folderRoutes)
  await fastify.register(photoRoutes)
  await fastify.register(uploadRoutes)
  await fastify.register(friendshipRoutes)
  await fastify.register(notificationRoutes)
  await fastify.register(commentRoutes)
  await fastify.register(postRoutes)
  await fastify.register(async (f) => messageRoutes(f, io))
  await fastify.register(exploreRoutes)
  await fastify.register(dashboardRoutes)

  // 404 handler
  fastify.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: `Route ${req.method} ${req.url} not found` })
  })

  // Error handler
  fastify.setErrorHandler((error: { statusCode?: number; message?: string }, req, reply) => {
    fastify.log.error(error)
    reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
    })
  })

  // Start listening
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`
🚀 GeoSnap API running at http://localhost:${PORT}
📦 Environment: ${process.env.NODE_ENV || 'development'}
🔌 Socket.io ready
❤️  Health check: http://localhost:${PORT}/health
  `)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
