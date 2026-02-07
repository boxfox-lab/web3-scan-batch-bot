export const SCRAPING_HOST = 'https://13c62c3ee687.ngrok-free.app/scraping/run';

export const CHUNK_SIZE = 5;

export const ARKHAM_ENTITIES = [
  'usg',
  'uk',
  'bitmine',
  'binance',
  'bitwise',
  'vitalik-buterin',
  'satoshi-nakamoto',
  'blackrock',
  'trump-media',
  'donald-trump',
  'coinone',
  'bithumb',
  'vaneck',
  'upbit',
  'wintermute',
  'worldlibertyfi',
  'arthur-hayes',
  'robinhood',
  'coinbase',
  'microstrategy',
] as const;

export type ArkhamEntity = typeof ARKHAM_ENTITIES[number];

export function buildArkhamEntityUrl(entity: string): string {
  return `https://intel.arkm.com/explorer/entity/${entity}`;
}

/**
 * Arkham Intel 포트폴리오 페이지에서 토큰 데이터를 추출하는 브라우저 스크래핑 스크립트.
 * 스크래핑 서버의 bridge 인터페이스를 통해 실행된다.
 *
 * 추출 데이터: symbol, name, icon, holdings, value, changePercent, holder
 * 추출 후 https://api.compounding.co.kr/web3-scan/portfolios 로 100개씩 청크 전송.
 */
export function buildScrapingScript(): string {
  return `(async (bridge) => {
    // --- 1. 유틸리티 함수 정의 ---

    /**
     * '27M', '18K', '5B' 등의 단위를 포함하는 문자열을 정확한 숫자 값으로 변환합니다.
     */
    function parseCurrencyValue(valueStr) {
        if (!valueStr) return 0;
        const cleanStr = valueStr.trim().replace('$', '').replace(/,/g, '').replace('...', '').toUpperCase();
        const unitMultipliers = { 'B': 1000000000, 'M': 1000000, 'K': 1000 };

        let multiplier = 1;
        let numericPart = cleanStr;
        const unit = cleanStr.slice(-1);

        if (unitMultipliers[unit]) {
            multiplier = unitMultipliers[unit];
            numericPart = cleanStr.slice(0, -1);
        }
        const value = parseFloat(numericPart) || 0;
        return value * multiplier;
    }

    /**
     * 현재 URL에서 마지막 경로 세그먼트를 추출하여 holder로 사용합니다.
     */
    function getHolderFromUrl() {
        const path = window.location.pathname;
        const segments = path.split('/').filter(s => s.length > 0);
        return segments.pop() || 'unknown_holder';
    }

    /**
     * 데이터를 100개씩 청크로 나누어 순차적으로 API에 POST 요청을 보냅니다.
     */
    async function sendDataInChunks(data) {
        const chunkSize = 100;
        const totalChunks = Math.ceil(data.length / chunkSize);
        const apiUrl = 'https://api.compounding.co.kr/web3-scan/portfolios';

        console.log(\`데이터 파싱 완료 (총 \${data.length}개). API 전송 시작...\`);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chunk),
                });
                
                if (!response.ok) {
                    console.error(\`청크 \${i + 1} 전송 실패 (HTTP \${response.status})\`);
                }
            } catch (error) {
                console.error(\`청크 \${i + 1} 네트워크 요청 중 오류 발생:\`, error);
            }
        }
        console.log("모든 청크 전송 작업이 완료되었습니다.");
    }

    /**
     * DOM에서 데이터를 추출하는 함수
     * 데이터가 아직 로딩되지 않았으면 null을 반환합니다.
     */
    function extractData() {
        const tokenGrid = document.querySelector('.Portfolio-module__ktaGya__tokenGrid');
        
        // 테이블이 아직 없으면 null 리턴 (재시도 유도)
        if (!tokenGrid) return null;

        const tokenEntries = tokenGrid.querySelectorAll('.Portfolio-module__ktaGya__tokenEntryRow');
        
        // 로우가 하나도 없으면 로딩 중일 수 있으므로 null 리턴
        if (tokenEntries.length === 0) return null;

        const parsedData = [];
        const holder = getHolderFromUrl();

        tokenEntries.forEach(row => {
            // --- A. 심볼, 이름, 아이콘 ---
            const assetElement = row.querySelector('.Portfolio-module__ktaGya__start');
            let name = 'N/A', symbol = 'N/A', icon = 'N/A';

            if (assetElement) {
                const symbolElement = assetElement.querySelector('.Portfolio-module__ktaGya__tokenSymbol');
                if (symbolElement) {
                    symbol = symbolElement.textContent.trim()
                        .replace(/TRADE NOW|BUY|SELL|\\s+/gi, '').trim();
                }
                const imgElement = assetElement.querySelector('img');
                if (imgElement) {
                    if (imgElement.alt) name = imgElement.alt.trim();
                    if (imgElement.src) icon = imgElement.src;
                }
            }

            if (symbol === 'N/A' || symbol === 'ASSET') return;

            // --- B. 보유량 ---
            let holdings = 0;
            const holdingsContainer = row.querySelector('.Portfolio-module__ktaGya__holdingsContainer');
            if (holdingsContainer) {
                const holdingsSpan = holdingsContainer.querySelector('span:not(.Portfolio-module__ktaGya__tokenSymbol)');
                if (holdingsSpan) holdings = parseCurrencyValue(holdingsSpan.textContent);
            }

            // --- C. 가치 ---
            let value = 0;
            const valueCol = row.querySelector('.Portfolio-module__ktaGya__valueCol');
            if (valueCol) {
                const valueSpan = valueCol.querySelector('span');
                const valueText = valueSpan ? valueSpan.textContent.trim() : valueCol.textContent.trim();
                value = parseCurrencyValue(valueText);
            }

            // --- D. 변동률 ---
            let changePercent = 0;
            const changeContainer = row.querySelector('.ValueChange-module__V0-tkG__container');
            if (changeContainer) {
                const changeSpan = changeContainer.querySelector('span');
                if (changeSpan) {
                    const changeText = changeSpan.textContent.trim().replace(/[+-]|\\%/g, '');
                    let percentValue = parseFloat(changeText) || 0;
                    
                    if (changeSpan.textContent.includes('-')) {
                        changePercent = -Math.abs(percentValue);
                    } else {
                        changePercent = Math.abs(percentValue);
                    }
                }
            }

            parsedData.push({
                symbol, name, icon, holdings, value, changePercent, holder
            });
        });

        return parsedData;
    }

    // --- 2. 실행 루프 (Polling) ---
    
    let tries = 0;
    const MAX_TRIES = 300; // 100ms * 300 = 30초 타임아웃

    const timer = setInterval(async () => {
        tries++;
        const data = extractData();

        // 1. 데이터 추출 성공 시
        if (data && data.length > 0) {
            clearInterval(timer); // 타이머 중지

            try {
                // 외부 API로 데이터 전송 (비동기 대기)
                await sendDataInChunks(data);

                // 전송 완료 후 브릿지에 성공 메시지 전달
                bridge.postMessage({
                    status: "DONE",
                    count: data.length
                });
            } catch (e) {
                bridge.postMessage({
                    status: "ERROR",
                    reason: "API_SEND_FAILED",
                    detail: e.toString()
                });
            }
            return;
        }

        // 2. 타임아웃 발생 시
        if (tries >= MAX_TRIES) {
            clearInterval(timer);
            bridge.postMessage({
                status: "ERROR",
                reason: "timeout"
            });
        }
    }, 100);

})(bridge);`;
}
