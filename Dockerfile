# ---------- build stage ----------
# `node:24-alpine` désigne le dernier correctif de la ligne 24, mais seulement si l'image
# est retéléchargée : `docker build` réutilise sinon celle déjà présente sur la machine, et
# le correctif reste figé sans que rien ne le dise. D'où `--pull` au build (côté Dokku :
# `dokku docker-options:add <app> build "--pull"`). Si l'image en cache est antérieure au
# dernier bulletin, le plancher d'`engines.node` (appliqué par `engine-strict`, dans
# `.npmrc`) fait échouer le `npm ci` ci-dessous plutôt que de livrer un Node vulnérable.
FROM node:24-alpine AS builder

WORKDIR /app

# Installer les dépendances (`.npmrc` porte `engine-strict`)
COPY package*.json .npmrc ./
RUN npm ci

# Copier les configs de build
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Copier le code source
COPY src ./src

# Build
RUN npm run build


# ---------- production stage ----------
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Dépendances prod uniquement
COPY package*.json .npmrc ./
RUN npm ci --omit=dev

# Copie du build depuis l'étape builder
COPY --from=builder /app/dist ./dist

# CHANGEMENT DE PROPRIÉTAIRE
RUN chown -R node:node /app

# On bascule sur l'utilisateur node pour la sécurité
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
