# Use official Puppeteer image which has Chrome and all dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:22.13.0

# Switch to root to install FFmpeg
USER root

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the TypeScript files
RUN npm run build

# Create directory for output videos
RUN mkdir -p output

# Switch back to the puppeteer user for security
USER pptruser

# Set entrypoint to our CLI
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
