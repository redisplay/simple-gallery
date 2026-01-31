FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3456

ENV PORT=3456
ENV DATA_DIR=/data

VOLUME /data

CMD ["node", "server.js"]
