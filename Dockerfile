FROM node:24-alpine

# 排程時間以台北時區為準（node-cron 另有 CRON_TIMEZONE，這裡讓 log 時間也一致）
RUN apk add --no-cache tzdata
ENV TZ=Asia/Taipei NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY backtest ./backtest

EXPOSE 3000
CMD ["node", "src/index.js"]
