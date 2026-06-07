FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

CMD ["node", "server.js"]
