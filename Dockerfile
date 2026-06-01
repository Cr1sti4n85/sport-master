FROM node:24.16.0-alpine3.23

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src

COPY drizzle.config.js ./
COPY drizzle ./drizzle

EXPOSE 8080

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["npm", "start"]