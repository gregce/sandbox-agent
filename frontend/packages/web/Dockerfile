FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/packages/web/package.json ./frontend/packages/web/
COPY sdks/typescript/package.json ./sdks/typescript/

# Install dependencies
RUN pnpm install --filter @sandbox-agent/web...

# Copy SDK source (with pre-generated types)
COPY sdks/typescript ./sdks/typescript

# Build SDK (just tsc, skip generate since types are pre-generated)
RUN cd sdks/typescript && pnpm exec tsc -p tsconfig.json

# Copy web source
COPY frontend/packages/web ./frontend/packages/web

# Build web
RUN cd frontend/packages/web && pnpm exec vite build

FROM caddy:alpine
COPY --from=build /app/frontend/packages/web/dist /srv
RUN cat > /etc/caddy/Caddyfile <<'EOF'
:80 {
	root * /srv
	file_server
	try_files {path} /index.html
}
EOF
EXPOSE 80
