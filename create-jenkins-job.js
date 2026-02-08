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
const configPath = path.join(__dirname, 'jenkins-config-basic.xml');
const configXml = fs.readFileSync(configPath, 'utf8');

// Jenkins API 호출
const url = new URL(`${JENKINS_URL}/createItem?name=web3-scan-batch-bot`);
const auth = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString('base64');

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
  console.log(`Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Jenkins job "web3-scan-batch-bot" created successfully!');
      console.log(`📍 Job URL: ${JENKINS_URL}/job/web3-scan-batch-bot/`);
    } else {
      console.error('❌ Failed to create job');
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
