# 假 Dockerfile（sandbox 种子）：敏感路径样本——CI 与发布类
# 仅占位，T4 敏感路径拦截的测试目标物，不用于真实构建。
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm ci
COPY . .
CMD ["node", "src/main.js"]
