import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import type { StringValue } from 'ms'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { verifyGoogleToken, getGoogleAuthUrl, verifyFacebookToken, getFacebookAuthUrl } from '../services/oauth'

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as StringValue })
}

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

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  fastify.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, password, displayName } = req.body as {
      email: string; password: string; displayName?: string
    }

    if (!email || !password) return reply.status(400).send({ error: 'Email và mật khẩu là bắt buộc' })
    if (password.length < 6) return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' })

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.status(409).send({ error: 'Email đã được sử dụng' })

    const passwordHash = await bcrypt.hash(password, 6)
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName: displayName || email.split('@')[0] },
    })

    const token = signToken(user.id)
    return reply.send({ token, user: formatUser(user) })
  })

  // POST /auth/login
  fastify.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = req.body as { email: string; password: string }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Email hoặc mật khẩu không đúng' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Email hoặc mật khẩu không đúng' })

    const token = signToken(user.id)
    return reply.send({ token, user: formatUser(user) })
  })

  // GET /auth/google - redirect to Google
  fastify.get('/auth/google', async (req: FastifyRequest, reply: FastifyReply) => {
    if (process.env.GOOGLE_CLIENT_ID === 'placeholder') {
      return reply.redirect(`/auth/google/callback?code=mock_code`)
    }
    return reply.redirect(getGoogleAuthUrl())
  })

  // GET /auth/google/callback
  fastify.get('/auth/google/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = req.query as { code: string }
    if (!code) return reply.status(400).send({ error: 'No code provided' })

    try {
      let googleUser;
      if (code === 'mock_code' || process.env.GOOGLE_CLIENT_ID === 'placeholder') {
        googleUser = {
          email: 'mock_google_user@gmail.com',
          name: 'Demo Google User',
          picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150',
        };
      } else {
        googleUser = await verifyGoogleToken(code)
      }
      
      let user = await prisma.user.findUnique({ where: { email: googleUser.email } })
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: googleUser.email,
            displayName: googleUser.name,
            avatarUrl: googleUser.picture,
          },
        })
      } else if (!user.avatarUrl) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: googleUser.picture, displayName: googleUser.name },
        })
      }

      const token = signToken(user.id)
      // Redirect to frontend with token
      return reply.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)
    } catch (err) {
      console.error(err)
      return reply.redirect(`${FRONTEND_URL}/login?error=google_failed`)
    }
  })

  // GET /auth/facebook - redirect to Facebook
  fastify.get('/auth/facebook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (process.env.FACEBOOK_APP_ID === 'placeholder') {
      return reply.redirect(`/auth/facebook/callback?code=mock_code`)
    }
    return reply.redirect(getFacebookAuthUrl())
  })

  // GET /auth/facebook/callback
  fastify.get('/auth/facebook/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = req.query as { code: string }
    if (!code) return reply.status(400).send({ error: 'No code provided' })

    try {
      let fbUser;
      if (code === 'mock_code' || process.env.FACEBOOK_APP_ID === 'placeholder') {
        fbUser = {
          id: '123456789',
          name: 'Demo Facebook User',
          email: 'mock_facebook_user@facebook.com',
          picture: { data: { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150' } },
        };
      } else {
        fbUser = await verifyFacebookToken(code)
      }
      
      const email = fbUser.email || `fb_${fbUser.id}@facebook.com`
      const avatarUrl = fbUser.picture?.data?.url

      let user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
        user = await prisma.user.create({
          data: { email, displayName: fbUser.name, avatarUrl },
        })
      }

      const token = signToken(user.id)
      return reply.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)
    } catch (err) {
      console.error(err)
      return reply.redirect(`${FRONTEND_URL}/login?error=facebook_failed`)
    }
  })

  // POST /auth/reset-password
  fastify.post('/auth/reset-password', async (req: FastifyRequest, reply: FastifyReply) => {
    // In a real app, you'd send an email. For now, return success.
    const { email } = req.body as { email: string }
    const user = await prisma.user.findUnique({ where: { email } })
    // Don't reveal if user exists or not
    return reply.send({ message: 'Nếu email tồn tại, bạn sẽ nhận được link đặt lại mật khẩu.' })
  })

  // POST /auth/refresh
  fastify.post('/auth/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'No token' })

    const oldToken = authHeader.slice(7)
    try {
      const decoded = jwt.verify(oldToken, JWT_SECRET) as { userId: string }
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } })
      if (!user) return reply.status(401).send({ error: 'User not found' })

      const token = signToken(user.id)
      return reply.send({ token, user: formatUser(user) })
    } catch {
      return reply.status(401).send({ error: 'Invalid token' })
    }
  })
}
