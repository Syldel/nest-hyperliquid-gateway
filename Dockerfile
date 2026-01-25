# ---------- build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# fichiers nécessaires au build
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# installer TOUTES les deps (y compris dev)
RUN npm ci

# copier le code
COPY . .

# build NestJS
RUN npm run build


# ---------- production stage ----------
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# dépendances prod uniquement
COPY package*.json ./
RUN npm ci --omit=dev

# code compilé uniquement
COPY --from=builder /app/dist ./dist

EXPOSE 3005

CMD ["node", "dist/main.js"]
