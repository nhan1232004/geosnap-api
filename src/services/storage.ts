import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME!
const PUBLIC_URL = process.env.R2_PUBLIC_URL!

export type UploadType = 'photos' | 'avatars' | 'covers' | 'posts' | 'stories'

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const isPlaceholder = !process.env.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID === 'placeholder'

  if (isPlaceholder) {
    const uploadsDir = join(process.cwd(), 'uploads')
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true })
    }
    const filename = key.split('/').pop() || `${Date.now()}.jpg`
    const filePath = join(uploadsDir, filename)
    writeFileSync(filePath, buffer)

    const backendUrl = process.env.GOOGLE_REDIRECT_URI
      ? process.env.GOOGLE_REDIRECT_URI.replace('/auth/google/callback', '')
      : 'http://localhost:3001'
    return `${backendUrl}/uploads/${filename}`
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
  return `${PUBLIC_URL}/${key}`
}

export async function uploadPhoto(
  buffer: Buffer,
  userId: string,
  filename: string,
  maxDimension = 1200
): Promise<string> {
  // Resize & compress with sharp
  const optimized = await sharp(buffer)
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true })
    .toBuffer()

  const key = `photos/${userId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}.jpg`
  return uploadFile(optimized, key, 'image/jpeg')
}

export async function uploadAvatar(buffer: Buffer, userId: string): Promise<string> {
  const optimized = await sharp(buffer)
    .resize(400, 400, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer()

  const key = `avatars/${userId}/${Date.now()}.jpg`
  return uploadFile(optimized, key, 'image/jpeg')
}

export async function uploadCover(buffer: Buffer, userId: string): Promise<string> {
  const optimized = await sharp(buffer)
    .resize(1200, 400, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toBuffer()

  const key = `covers/${userId}/${Date.now()}.jpg`
  return uploadFile(optimized, key, 'image/jpeg')
}

export async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export function getKeyFromUrl(url: string): string {
  return url.replace(`${PUBLIC_URL}/`, '')
}
