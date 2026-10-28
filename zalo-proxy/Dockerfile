FROM node:24-slim
WORKDIR /app
COPY proxy.js .
USER node
EXPOSE 8787
CMD ["node", "proxy.js"]
