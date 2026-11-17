FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app ./

# Create data directory for persistent SQLite or local storage
RUN mkdir -p /data

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node src/server.js"]
