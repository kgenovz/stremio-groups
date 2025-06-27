# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directory for database
RUN mkdir -p /app/db

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]