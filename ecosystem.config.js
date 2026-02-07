const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

module.exports = [
  {
    script: "dist/src/index.js",
    name: "web3-scan-batch-bot",
    autorestart: true,
    max_restarts: 0,
    min_uptime: "10s",
    max_memory_restart: "500M",
    restart_delay: 1000,
    watch: false,
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    max_log_size: "10M",
    retain_logs: 5,
    env: {
      TZ: "Asia/Seoul",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      GOOGLE_SEARCH_API_KEY: process.env.GOOGLE_SEARCH_API_KEY,
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID,
      DISCORD_DEV_WEBHOOK_URL: process.env.DISCORD_DEV_WEBHOOK_URL,
    },
  },
];
