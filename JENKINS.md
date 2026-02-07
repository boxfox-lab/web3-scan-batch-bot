# Jenkins 파이프라인 등록

Jenkins (http://1.234.82.82:8088/) 에서 이 프로젝트를 파이프라인으로 등록하는 방법입니다.

## 등록 절차

1. Jenkins 접속 → **새로운 Item**
2. **이름**: `cocoscan-batch-bot` (또는 원하는 이름)
3. **Pipeline** 선택 → **OK**
4. **Pipeline** 섹션에서:
   - **Definition**: `Pipeline script from SCM`
   - **SCM**: `Git`
   - **Repository URL**: `https://github.com/boxfox-lab/cocoscan-batch-bot.git`
   - **Branch**: `*/main`
5. **저장** 후 **Build Now** 로 첫 빌드 실행

## 필요 환경

- Jenkins 에이전트에 **Node.js** 및 **yarn** 설치
- (선택) Credentials 에 GitHub 접근 권한 설정 후 Repo URL 에 적용
