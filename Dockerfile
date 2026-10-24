FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai
COPY package.json ./
COPY server.js rooms.js engine.js skills.js data.js accounts.js ./
COPY public ./public
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
