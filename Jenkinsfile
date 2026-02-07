pipeline {
    agent any
    environment {
        DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1468444406016118816/wz2J3kLDcNAo1FjJpdH-R7ly4NItzjv70K6L_iWBLzwULqTUcjN8lmZbpCJx_zB6_A9R'
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Install Dependencies') {
            steps {
                sh 'yarn install'
            }
        }
        stage('Unit & E2E Tests') {
            steps {
                sh 'yarn test'
            }
        }
        stage('Build Check') {
            steps {
                sh 'yarn build'
            }
        }
        stage('Discord QA Notification') {
            steps {
                sh """
                    curl -X POST -H "Content-Type: application/json" \
                    -d '{"content": "🚀 **${env.JOB_NAME}** (cocoscan-batch-bot) build #${env.BUILD_NUMBER} successful! \\nCheck it out: ${env.BUILD_URL}"}' \
                    ${env.DISCORD_WEBHOOK}
                """
            }
        }
    }
    post {
        failure {
            sh """
                curl -X POST -H "Content-Type: application/json" \
                -d '{"content": "❌ **${env.JOB_NAME}** (cocoscan-batch-bot) build #${env.BUILD_NUMBER} failed! \\nLogs: ${env.BUILD_URL}console"}' \
                ${env.DISCORD_WEBHOOK}
            """
        }
    }
}
