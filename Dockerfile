FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

USER node

CMD ["node", "dist/main.js"]