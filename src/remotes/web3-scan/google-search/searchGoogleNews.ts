import axios from 'axios';

export interface GoogleNewsResult {
  title: string;
  link: string;
  snippet: string;
  source?: string;
  date?: string;
}

export interface GoogleSearchResponse {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    displayLink?: string;
    formattedUrl?: string;
  }>;
}

export async function searchGoogleNews(
  query: string,
  maxResults = 5,
): Promise<GoogleNewsResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    console.warn(
      '[GoogleSearch] GOOGLE_SEARCH_API_KEY 또는 GOOGLE_SEARCH_ENGINE_ID가 설정되지 않았습니다.',
    );
    return [];
  }

  try {
    // 한국어 뉴스 검색을 위해 쿼리에 "뉴스" 추가
    const searchQuery = `${query} 암호화폐 뉴스`;
    const url = 'https://www.googleapis.com/customsearch/v1';

    const response = await axios.get<GoogleSearchResponse>(url, {
      params: {
        key: apiKey,
        cx: searchEngineId,
        q: searchQuery,
        num: Math.min(maxResults, 10), // 최대 10개
        safe: 'active',
        lr: 'lang_ko', // 한국어 결과만
        gl: 'kr', // 한국 지역
      },
      timeout: 10000,
    });

    if (!response.data.items || response.data.items.length === 0) {
      return [];
    }

    return response.data.items.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      source: item.displayLink || item.formattedUrl,
    }));
  } catch (error) {
    // 403 에러는 API 키 문제이거나 할당량 초과일 수 있음
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data?.error;
      const errorMessage = errorData?.message || error.message;
      const errorReason = errorData?.errors?.[0]?.reason || errorData?.reason;
      
      if (status === 403) {
        console.warn(
          `[GoogleSearch] API 접근 거부 (403): ${errorMessage}`,
        );
        if (errorReason) {
          console.warn(`[GoogleSearch] 에러 원인: ${errorReason}`);
        }
        console.warn(
          `[GoogleSearch] 해결 방법 확인:\n` +
            `  1. Google Cloud Console에서 Custom Search JSON API가 활성화되어 있는지 확인\n` +
            `  2. API 키 제한 설정 확인 (HTTP referrer 제한이 있으면 제거)\n` +
            `  3. API 키와 Search Engine ID가 같은 프로젝트에 속해 있는지 확인\n` +
            `  4. 일일 할당량 초과 여부 확인\n` +
            `  5. Search Engine이 "전체 웹 검색"으로 설정되어 있는지 확인\n`,
        );
        console.warn('[GoogleSearch] 뉴스 검색을 건너뜁니다.');
      } else {
        console.warn(
          `[GoogleSearch] 검색 실패 (${status || 'unknown'}): ${errorMessage}. 뉴스 검색을 건너뜁니다.`,
        );
      }
    } else {
      console.warn('[GoogleSearch] 검색 실패. 뉴스 검색을 건너뜁니다.');
    }
    return [];
  }
}

