FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
