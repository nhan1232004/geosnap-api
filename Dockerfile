FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install production deps only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production && npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist/

EXPOSE 3001

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
