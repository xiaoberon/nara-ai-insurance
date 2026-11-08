FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080 NARA_PUBLIC=1
USER node
EXPOSE 8080
CMD ["npm", "run", "showcase"]
