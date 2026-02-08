import axios from 'axios';

export class ScrapingUrlService {
  private readonly BACKEND_API_URL =
    process.env.WEB3_SCAN_BACKEND_URL || 'https://api.compounding.co.kr/web3-scan';
  private readonly LOCAL_URL = process.env.SCRAPING_LOCAL_URL; // 로컬 URL (옵션)
  private readonly FALLBACK_URL =
    'https://13c62c3ee687.ngrok-free.app/scraping/run';

  private cachedUrl: string | null = null;
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL = 600000; // 10분

  /**
   * Scraping URL 조회 (Local → Backend API → Fallback)
   */
  async getScrapingUrl(): Promise<string> {
    // 1. 캐시 확인
    if (this.cachedUrl && Date.now() - this.lastFetchTime < this.CACHE_TTL) {
      return this.cachedUrl;
    }

    // 2. 로컬 URL이 설정되어 있으면 사용 (최우선)
    if (this.LOCAL_URL) {
      this.cachedUrl = this.LOCAL_URL;
      this.lastFetchTime = Date.now();
      console.log(`[ScrapingUrlService] Using local URL: ${this.LOCAL_URL}`);
      return this.LOCAL_URL;
    }

    // 3. Backend API에서 조회
    try {
      const response = await axios.get(
        `${this.BACKEND_API_URL}/config/ngrok-url`,
        { timeout: 5000 },
      );

      if (response.data.success && response.data.url) {
        this.cachedUrl = response.data.url + '/scraping/run';
        this.lastFetchTime = Date.now();
        console.log(`[ScrapingUrlService] Fetched URL from backend: ${this.cachedUrl}`);
        return this.cachedUrl;
      }
    } catch (error: any) {
      console.warn(`[ScrapingUrlService] Failed to fetch from backend: ${error.message}`);
    }

    // 4. Fallback
    console.warn(`[ScrapingUrlService] ⚠️  Using fallback URL: ${this.FALLBACK_URL}`);
    return this.FALLBACK_URL;
  }
}
