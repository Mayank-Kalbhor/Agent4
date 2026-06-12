# Stage 1: Build dependency tree
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Stage 2: Production release
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app /app

# Run as non-root user
USER node
EXPOSE 5001
ENV PORT=5001
CMD ["node", "server.js"]
