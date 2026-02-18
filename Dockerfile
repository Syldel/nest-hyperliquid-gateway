# ---------- build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Installer les dépendances
COPY package*.json ./
RUN npm ci

# Copier les configs de build
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Copier le code source
COPY src ./src

# Build
RUN npm run build


# ---------- production stage ----------
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Dépendances prod uniquement
COPY package*.json ./
RUN npm ci --omit=dev

# Copie du build depuis l'étape builder
COPY --from=builder /app/dist ./dist

# CHANGEMENT DE PROPRIÉTAIRE
RUN chown -R node:node /app

# On bascule sur l'utilisateur node pour la sécurité
USER node

EXPOSE 3005

CMD ["node", "dist/main.js"]
