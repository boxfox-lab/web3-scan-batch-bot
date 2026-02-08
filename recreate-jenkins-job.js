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

const auth = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString('base64');

// Step 1: Delete existing job
function deleteJob() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${JENKINS_URL}/job/web3-scan-batch-bot/doDelete`);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      }
    };

    const req = https.request(options, (res) => {
      console.log(`Delete Status: ${res.statusCode}`);

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 302 || res.statusCode === 200) {
          console.log('✅ Old job deleted successfully');
          resolve();
        } else {
          console.log('⚠️  Delete response:', res.statusCode);
          resolve(); // Continue even if delete fails (job might not exist)
        }
      });
    });

    req.on('error', (error) => {
      console.log('⚠️  Delete error (job might not exist):', error.message);
      resolve(); // Continue even if delete fails
    });

    req.end();
  });
}

// Step 2: Create new job
function createJob() {
  return new Promise((resolve, reject) => {
    const configPath = path.join(__dirname, 'jenkins-config-final.xml');
    const configXml = fs.readFileSync(configPath, 'utf8');

    const url = new URL(`${JENKINS_URL}/createItem?name=web3-scan-batch-bot`);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(configXml)
      }
    };

    const req = https.request(options, (res) => {
      console.log(`Create Status: ${res.statusCode}`);

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('✅ Jenkins job "web3-scan-batch-bot" created successfully!');
          console.log(`📍 Job URL: ${JENKINS_URL}/job/web3-scan-batch-bot/`);
          console.log('');
          console.log('✨ 설정 완료:');
          console.log('   - dev 브랜치 자동 트리거 (5분마다 체크)');
          console.log('   - Discord Webhook URL을 스크립트 상수로 설정');
          console.log('   - 환경변수 5개 (OPENAI, GEMINI, YOUTUBE, GOOGLE_SEARCH x2)');
          console.log('');
          console.log('⚙️  다음 단계:');
          console.log('   1. Jenkins에서 환경변수 Credentials 설정');
          console.log('   2. dev 브랜치에 커밋 푸시 시 자동 배포 확인');
          resolve();
        } else {
          console.error('❌ Failed to create job');
          console.error('Response:', data);
          reject(new Error('Job creation failed'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Error:', error.message);
      reject(error);
    });

    req.write(configXml);
    req.end();
  });
}

// Execute
(async () => {
  try {
    console.log('🔄 Step 1: Deleting old job...');
    await deleteJob();

    console.log('');
    console.log('🔄 Step 2: Creating new job with dev branch trigger...');
    await createJob();
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
})();
