#!/usr/bin/env node

const https = require('http');
const fs = require('fs');
const path = require('path');

// Jenkins 설정 로드
const envPath = path.join(process.env.HOME, '.cursor', 'jenkins.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) env[key.trim()] = value.trim();
});

const JENKINS_URL = env.JENKINS_URL || 'http://1.234.82.82:8088';
const JENKINS_USER = env.JENKINS_USER;
const JENKINS_TOKEN = env.JENKINS_TOKEN;

if (!JENKINS_USER || !JENKINS_TOKEN) {
  console.error('Error: JENKINS_USER or JENKINS_TOKEN not set');
  process.exit(1);
}

// Config XML 읽기
const configPath = path.join(__dirname, 'jenkins-config-final.xml');
const configXml = fs.readFileSync(configPath, 'utf8');

// Jenkins API 호출 (config.xml 업데이트)
const url = new URL(`${JENKINS_URL}/job/web3-scan-batch-bot/config.xml`);
const auth = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString('base64');

const options = {
  hostname: url.hostname,
  port: url.port,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/xml',
    'Authorization': `Basic ${auth}`,
    'Content-Length': Buffer.byteLength(configXml)
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Jenkins job "web3-scan-batch-bot" updated successfully!');
      console.log('📍 Job URL: http://1.234.82.82:8088/job/web3-scan-batch-bot/');
      console.log('');
      console.log('✨ 변경 사항:');
      console.log('   - DISCORD_DEV_WEBHOOK_URL을 환경변수에서 제거');
      console.log('   - Discord Webhook URL을 스크립트 상수로 변경');
      console.log('');
      console.log('⚙️  환경변수 5개만 설정하면 됩니다:');
      console.log('   1. OPENAI_API_KEY');
      console.log('   2. GEMINI_API_KEY');
      console.log('   3. YOUTUBE_API_KEY');
      console.log('   4. GOOGLE_SEARCH_API_KEY');
      console.log('   5. GOOGLE_SEARCH_ENGINE_ID');
    } else {
      console.error('❌ Failed to update job');
      console.error('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

req.write(configXml);
req.end();
