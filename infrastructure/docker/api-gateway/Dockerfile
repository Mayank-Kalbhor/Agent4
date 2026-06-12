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

# Run as non-root user for security compliance
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "index.js"]
