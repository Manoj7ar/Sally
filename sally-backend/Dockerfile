FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js logger.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
