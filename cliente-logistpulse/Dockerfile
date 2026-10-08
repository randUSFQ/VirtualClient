FROM node:22-slim

WORKDIR /app

# Dependencias primero: la capa se reutiliza mientras package*.json no cambie
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

# Los datos viven en un volumen, fuera de la imagen; el usuario "node" no es root
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/app.db
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
