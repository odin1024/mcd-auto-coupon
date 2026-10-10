# 麦门券官 mcd-auto-coupon —— 轻量 Node 零依赖服务
FROM node:22-alpine

WORKDIR /app

# 先装依赖（零依赖项目，保留此步以兼容未来依赖）
COPY package*.json ./
RUN npm install --omit=dev

# 拷贝源码
COPY . .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
