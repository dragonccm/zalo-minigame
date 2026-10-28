# GameHub — image chạy production
#   docker build -t gamehub:1.0.0 .
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8080 \
    GAMEHUB_DATA=/app/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY sdk ./sdk
COPY seed-games ./seed-games

# data/ (game đã duyệt + bài nộp) phải gắn volume, nếu không sẽ mất khi container bị tạo lại
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
