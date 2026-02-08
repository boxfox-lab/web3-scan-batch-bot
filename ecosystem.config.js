const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// DB의 ngrok URL을 사용하기 위해 .env의 SCRAPING_LOCAL_URL 제거
delete process.env.SCRAPING_LOCAL_URL;

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
      WEB3_SCAN_BACKEND_URL: process.env.WEB3_SCAN_BACKEND_URL || 'https://api.compounding.co.kr/web3-scan',
      // SCRAPING_LOCAL_URL: .env 파일에서 delete로 제거됨 (DB ngrok URL 사용)
    },
  },
];
