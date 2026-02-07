import OpenAI from 'openai';
import { getSubtitles } from 'youtube-caption-extractor';
import { createYoutube, findAllYoutube } from '../../remotes/web3-scan/youtube';
import {
  getChannelByHandle,
  getChannelContentDetails,
  getPlaylistItems,
} from '../../remotes/youtube';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';

const YOUTUBE_CHANNELS = [
  '@JoshuaDeuk',
  '@ppause',
  '@BitShua',
  '@algoran',
  '@mentalisall',
  '@주독',
  '@코인드림',
];

export class Web3ScanService {
  constructor(private readonly openai: OpenAI) {}

  private async getVideoCaption(
    videoId: string,
  ): Promise<{ caption: string; language: 'ko' | 'en' } | null> {
    try {
      const captions = await getSubtitles({
        videoID: videoId,
        lang: 'ko', // 한국어 우선, 없으면 영어
      });

      if (!captions || captions.length === 0) {
        // 한국어가 없으면 영어로 시도
        const englishCaptions = await getSubtitles({
          videoID: videoId,
          lang: 'en',
        });
        if (!englishCaptions || englishCaptions.length === 0) {
          return null;
        }
        // youtube-caption-extractor는 각 항목이 text 속성을 가진 객체 배열
        return {
          caption: englishCaptions.map((c: any) => c.text || c).join(' '),
          language: 'en',
        };
      }
      // youtube-caption-extractor는 각 항목이 text 속성을 가진 객체 배열
      return {
        caption: captions.map((c: any) => c.text || c).join(' '),
        language: 'ko',
      };
    } catch (error) {
      console.error(`캡션 가져오기 실패 (${videoId}):`, error);
      return null;
    }
  }

  private async generateContentFromCaption(
    title: string,
    channelName: string,
    caption: string,
    language: 'ko' | 'en',
  ): Promise<{ title: string; content: string; shortSummary: string } | null> {
    try {
      const systemPrompt =
        language === 'ko'
          ? `당신은 암호화폐와 주식 투자 정보를 전문으로 다루는 블로그/브리핑/뉴스레터 작가입니다. 
유튜브 영상의 자막을 바탕으로 투자자들이 읽기 쉽고 이해하기 쉬운 설명형 글을 작성해주세요.

작성 가이드:
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용, 삭선 ~~텍스트~~ 사용 금지)
2. 블로그/브리핑/뉴스레터 스타일로 자연스러운 문단 형식으로 작성하세요. 단순 리스트 나열은 피하세요.
3. 각 문단은 자연스러운 설명형 문체로 작성하고, 정보를 문장으로 연결하여 설명하세요.
4. 암호화폐, 주식 등 투자 관련 정보를 중심으로 작성
5. 사실, 데이터, 해당 유튜버의 의견을 명확히 구분하여 제시하되, 문장으로 자연스럽게 설명하세요.
6. SEO 최적화를 고려한 구조화된 글 작성
7. 핵심 정보를 먼저 제시하고, 세부 내용을 이어서 설명
8. 투자 관련 키워드를 자연스럽게 포함
9. 유튜버의 의견이나 분석을 언급할 때는 반드시 구체적인 채널명을 포함하여 작성
   - 예: "유튜버의 분석" ❌
   - 예: "채널명의 분석" ✅ 또는 "유튜버 채널명의 분석" ✅
10. 객관적 사실과 주관적 의견을 구분하여 작성
11. 채널명은 항상 구체적으로 명시하여 작성
12. 각 정보를 문장으로 연결하여 설명하세요. 예: "일본 정부의 경기부양책 규모는 약 200조 원에 달하며..." 형식으로 작성
13. 자막은 자동 생성된 것이므로 발음이 어색하거나 이상한 단어가 있을 수 있습니다. 문맥상 유추 가능한 선에서 올바른 단어로 정정하여 문장이 자연스럽고 읽기 쉽게 작성하세요.
14. 반드시 일관된 존댓말 어투를 사용하세요. "~했습니다", "~입니다", "~되었습니다" 등 정중한 존댓말을 일관되게 사용하세요.

절대 금지 사항:
1. "AI로 요약했다", "이 글은 AI가 작성했습니다", "요약본입니다" 등 메타 설명이나 작성 과정에 대한 언급을 포함하지 마세요. 순수하게 요약된 콘텐츠만 작성하세요.
2. "참고 출처", "채널명:", "영상 제목:", "출처:" 등 메타 정보나 참고 문구를 포함하지 마세요. 본문 내용만 작성하세요.
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요.
4. "(영상 내 '유닛 수업'으로 언급)", "(영상에서 ~라고 말함)" 등 발음이나 언급 방식에 대한 불필요한 설명을 포함하지 마세요. 내용만 자연스럽게 서술하세요.
5. 삭선(취소선) 마크다운 형식(~~텍스트~~)을 절대 사용하지 마세요. ~~ 기호를 사용하는 것은 완전히 금지됩니다. 삭선이 있는 내용은 삭선 없이 정상 텍스트로만 작성하세요. 자막에 삭선이 있어도 결과물에는 삭선을 포함하지 마세요.

작성해야 할 내용:
- 블로그 글에 적합한 새로운 제목 생성 (유튜브 영상 제목을 그대로 사용하지 말고, 글 내용에 맞게 SEO 최적화된 제목으로 각색/정리)
- 영상의 핵심 내용을 자연스러운 문단으로 요약
- 언급된 투자 관련 사실과 데이터를 문장으로 설명
- 채널명의 의견과 분석을 자연스럽게 서술 (반드시 채널명을 구체적으로 포함)
- SEO를 고려한 구조화된 형식`
          : `You are a professional blog/briefing/newsletter writer specializing in cryptocurrency and stock investment information.
Based on YouTube video captions, please write explanatory articles that are easy for investors to read and understand.

Writing Guidelines:
1. Write in markdown format (use #, ##, ### for headings, **bold**, *italic*, never use strikethrough ~~text~~)
2. Write in blog/briefing/newsletter style with natural paragraph format. Avoid simple list formats.
3. Write each paragraph in natural explanatory style, connecting information with sentences.
4. Focus on investment-related information such as cryptocurrency and stocks
5. Clearly distinguish facts, data, and the YouTuber's opinions, but explain them naturally in sentences.
6. Write structured content considering SEO optimization
7. Present key information first, then explain details
8. Naturally include investment-related keywords
9. When mentioning YouTuber's opinions or analysis, always include the specific channel name
   - Example: "the YouTuber's analysis" ❌
   - Example: "[Channel Name]'s analysis" ✅ or "YouTuber [Channel Name]'s analysis" ✅
10. Distinguish between objective facts and subjective opinions
11. Always specify the channel name clearly
12. Connect information with sentences. Example: "The Japanese government's economic stimulus package amounts to approximately 200 trillion won, and..." format
13. Captions are auto-generated, so there may be awkward pronunciations or unusual words. Correct them within reasonable context to make sentences natural and readable.
14. Use consistent formal tone throughout. Use polite expressions like "~했습니다", "~입니다", "~되었습니다" consistently.

Absolute Prohibitions:
1. Do not include meta descriptions like "summarized by AI", "this article was written by AI", "this is a summary". Write only pure summarized content.
2. Do not include meta information or reference phrases like "참고 출처", "채널명:", "영상 제목:", "출처:". Write only the main content.
3. Do not write in simple list format (-, *, numbers). Always use natural paragraphs and sentences.
4. Do not include unnecessary explanations about pronunciation or mentions like "(mentioned as 'unit lesson' in the video)", "(says ~ in the video)". Just naturally describe the content.
5. Never use strikethrough markdown format (~~text~~). Using ~~ symbols is completely prohibited. Write strikethrough content as normal text only. Even if captions have strikethrough, do not include strikethrough in the result.

What to Write:
- Create a new title suitable for blog posts (do not use YouTube video title as is, but adapt/arrange it as an SEO-optimized title that matches the article content)
- Summarize the video's core content in natural paragraphs
- Explain mentioned investment-related facts and data in sentences
- Naturally describe the channel name's opinions and analysis (always include the specific channel name)
- Structured format considering SEO`;

      const userPrompt =
        language === 'ko'
          ? `영상 제목: ${title}
채널명: ${channelName}

자막 내용:
${caption}`
          : `Video Title: ${title}
Channel Name: ${channelName}

Caption Content:
${caption}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        functions: [
          {
            name: 'generate_youtube_content',
            description:
              language === 'ko'
                ? '유튜브 영상 자막을 바탕으로 정리된 제목, 콘텐츠와 요약을 생성합니다.'
                : 'Generates organized title, content, and summary based on YouTube video captions.',
            parameters: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    language === 'ko'
                      ? '블로그 글에 적합한 새로운 제목 (유튜브 영상 제목이 아닌, 생성된 글 내용에 맞는 SEO 최적화된 제목으로 각색/정리)'
                      : 'New title suitable for blog posts (not the YouTube video title, but an SEO-optimized title adapted/arranged to match the generated article content)',
                },
                content: {
                  type: 'string',
                  description:
                    language === 'ko'
                      ? '정리된 전체 콘텐츠 (마크다운 형식)'
                      : 'Organized full content (markdown format)',
                },
                shortSummary: {
                  type: 'string',
                  description:
                    language === 'ko'
                      ? 'content를 3줄로 요약한 내용'
                      : 'Content summarized in 3 lines',
                },
              },
              required: ['title', 'content', 'shortSummary'],
            },
          },
        ],
        function_call: { name: 'generate_youtube_content' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'generate_youtube_content') {
        console.error(`Function call 실패 (${title})`);
        return null;
      }

      const args = JSON.parse(functionCall.arguments || '{}');

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      return {
        title: args.title || '',
        content: args.content || '',
        shortSummary: args.shortSummary || '',
      };
    } catch (error) {
      console.error(`GPT 콘텐츠 생성 실패 (${title}):`, error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'Web3ScanService.generateContentFromCaption',
        { title, channelName },
      );
      return null;
    }
  }

  private async translateContent(
    title: string,
    content: string,
    shortSummary: string,
    fromLanguage: 'ko' | 'en',
    toLanguage: 'ko' | 'en',
  ): Promise<{ title: string; content: string; shortSummary: string } | null> {
    try {
      const systemPrompt =
        toLanguage === 'ko'
          ? `당신은 암호화폐와 블록체인 투자 콘텐츠 전문 번역가입니다.
주어진 영어 블로그 포스트 제목과 콘텐츠를 자연스럽고 전문적인 한국어로 번역해주세요.

번역 가이드:
1. 동일한 마크다운 형식 유지 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용, 삭선 ~~텍스트~~ 사용 금지)
2. 블로그 포스트 스타일과 자연스러운 문단 형식 유지
3. 제목을 한국어 투자자들에게 SEO 최적화되고 매력적인 제목으로 번역
4. SEO 최적화 구조 유지:
   - 명확한 제목 구조 (H1, H2, H3)
   - 관련 키워드를 자연스럽게 포함
   - 읽기 쉬운 문단 구조 유지
5. 모든 콘텐츠를 자연스럽게 번역하며 의미와 톤 유지
6. 투자 관련 키워드 유지 (예: 암호화폐, 블록체인, 투자, 시장 분석)
7. 일관된 정중한 존댓말 톤 유지
8. **유튜브, 채널, 영상 또는 출처 언급을 절대 하지 마세요. 우리 자신의 분석과 정보인 것처럼 작성하세요.**

절대 금지 사항:
1. "AI로 요약했다" 또는 "이 글은 AI가 작성했습니다"와 같은 메타 설명을 포함하지 마세요
2. "참고 출처", "출처:", "채널", "유튜브", "영상"과 같은 메타 정보를 포함하지 마세요
3. 단순 리스트 형식(-, *, 번호)을 사용하지 마세요. 항상 자연스러운 문단과 문장을 사용하세요
4. 삭선 마크다운 형식(~~텍스트~~)을 절대 사용하지 마세요
5. "유튜버", "크리에이터", "채널명"과 같은 출처를 암시하는 단어를 사용하지 마세요`
          : `You are a professional translator specializing in cryptocurrency and blockchain investment content.
Translate the given Korean blog post title and content into natural, professional English.

Translation Guidelines:
1. Maintain the same markdown format (headings with #, ##, ###, bold with **, italic with *, never use strikethrough ~~text~~)
2. Keep the blog post style and natural paragraph format
3. Translate the title to be attractive and SEO-optimized for English-speaking investors
4. Maintain SEO-optimized structure:
   - Clear heading structure (H1, H2, H3)
   - Include relevant keywords naturally
   - Maintain readable paragraph structure
5. Translate all content naturally, preserving the meaning and tone
6. Keep investment-related keywords (e.g., cryptocurrency, blockchain, investment, market analysis)
7. Maintain consistent formal tone
8. **Never mention YouTube, channels, videos, or any source references. Write as our own analysis and information.**

Absolute Prohibitions:
1. Do not include meta descriptions like "This was summarized by AI" or "This article was written by AI"
2. Do not include meta information like "Reference source", "Source:", "Channel", "YouTube", "Video"
3. Do not use simple list format (-, *, numbers). Always use natural paragraphs and sentences
4. Never use strikethrough markdown format (~~text~~)
5. Do not use any words that imply sources like "YouTuber", "Creator", "Channel name"`;

      const userPrompt =
        toLanguage === 'ko'
          ? `다음 영어 블로그 포스트를 한국어로 번역해주세요:

제목: ${title}

콘텐츠:
${content}

요약:
${shortSummary}

마크다운 형식과 구조를 유지하면서 제목과 콘텐츠를 자연스럽고 전문적인 한국어로 번역해주세요.`
          : `Translate the following Korean blog post to English:

Title: ${title}

Content:
${content}

Summary:
${shortSummary}

Please translate the title, content, and summary to natural, professional English while maintaining the markdown format and structure.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        functions: [
          {
            name:
              toLanguage === 'ko'
                ? 'translate_to_korean'
                : 'translate_to_english',
            description:
              toLanguage === 'ko'
                ? '한국어로 번역된 블로그 포스트 제목, 콘텐츠, 요약을 생성합니다.'
                : 'Generates translated English blog post title, content, and summary.',
            parameters: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    toLanguage === 'ko'
                      ? '번역된 한국어 제목 (SEO 최적화, 투자자들에게 매력적)'
                      : 'Translated English title (SEO optimized, attractive to investors)',
                },
                content: {
                  type: 'string',
                  description:
                    toLanguage === 'ko'
                      ? '번역된 한국어 블로그 포스트 콘텐츠 (마크다운 형식)'
                      : 'Translated English blog post content (markdown format)',
                },
                shortSummary: {
                  type: 'string',
                  description:
                    toLanguage === 'ko'
                      ? '번역된 한국어 요약'
                      : 'Translated English summary',
                },
              },
              required: ['title', 'content', 'shortSummary'],
            },
          },
        ],
        function_call: {
          name:
            toLanguage === 'ko'
              ? 'translate_to_korean'
              : 'translate_to_english',
        },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (
        !functionCall ||
        (functionCall.name !== 'translate_to_korean' &&
          functionCall.name !== 'translate_to_english')
      ) {
        console.error(
          `번역 Function call 실패 (${fromLanguage} → ${toLanguage}, ${title})`,
        );
        return null;
      }

      const args = JSON.parse(functionCall.arguments || '{}');

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      return {
        title: args.title || '',
        content: args.content || '',
        shortSummary: args.shortSummary || '',
      };
    } catch (error) {
      console.error(
        `번역 실패 (${fromLanguage} → ${toLanguage}, ${title}):`,
        error,
      );
      await GlobalErrorHandler.handleError(
        error as Error,
        'Web3ScanService.translateContent',
        { title, fromLanguage, toLanguage },
      );
      return null;
    }
  }

  async process() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('YOUTUBE_API_KEY 환경 변수가 설정되지 않았습니다.');
      return;
    }

    for (const handle of YOUTUBE_CHANNELS) {
      try {
        // 1. 핸들 -> 채널 아이디
        const channelResponse = await getChannelByHandle(handle, apiKey);
        if (!channelResponse || channelResponse.items.length === 0) {
          console.log(`${handle}: 채널을 찾을 수 없습니다.`);
          continue;
        }

        const channelId = channelResponse.items[0].id;
        console.log(`${handle}: 채널 ID = ${channelId}`);

        // 2. 채널 아이디 -> 플레이리스트 아이디
        const contentDetailsResponse = await getChannelContentDetails(
          channelId,
          apiKey,
        );
        if (
          !contentDetailsResponse ||
          contentDetailsResponse.items.length === 0
        ) {
          console.log(`${handle}: contentDetails를 찾을 수 없습니다.`);
          continue;
        }

        const uploadsPlaylistId =
          contentDetailsResponse.items[0].contentDetails.relatedPlaylists
            .uploads;
        if (!uploadsPlaylistId) {
          console.log(`${handle}: uploads 플레이리스트를 찾을 수 없습니다.`);
          continue;
        }

        console.log(`${handle}: 플레이리스트 ID = ${uploadsPlaylistId}`);

        // 3. 플레이리스트 조회 (최근 10개만)
        const playlistItemsResponse = await getPlaylistItems(
          uploadsPlaylistId,
          apiKey,
          10,
        );
        if (
          !playlistItemsResponse ||
          playlistItemsResponse.items.length === 0
        ) {
          console.log(`${handle}: 영상 목록을 찾을 수 없습니다.`);
          continue;
        }

        console.log(
          `${handle}: 총 ${playlistItemsResponse.pageInfo.totalResults}개의 영상 중 최근 ${playlistItemsResponse.items.length}개 조회 완료`,
        );

        // 4. 해당 채널의 등록된 영상 목록 조회 (한 번만)
        let registeredLinks: Set<string> = new Set();
        try {
          const registeredVideos = await findAllYoutube(channelId);
          registeredLinks = new Set(registeredVideos.map((v) => v.link));
          console.log(
            `${handle}: 이미 등록된 영상 ${registeredLinks.size}개 확인`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // 429 에러는 재시도 로직에서 처리되지만, 최종 실패 시에도 계속 진행
          if (
            errorMessage.includes('429') ||
            errorMessage.includes('Rate limit')
          ) {
            console.warn(
              `${handle}: 등록된 영상 목록 조회 실패 (429 Rate Limit). 재시도 후에도 실패하여 등록된 영상 목록 없이 진행합니다.`,
            );
            // 429 에러는 경고만 하고 계속 진행 (중복 체크 없이 모든 영상 처리)
          } else {
            console.error(`${handle}: 등록된 영상 목록 조회 실패:`, error);
            await GlobalErrorHandler.handleError(
              error as Error,
              'Web3ScanService.findAllYoutube',
              { channelId, handle },
            );
            // 다른 에러도 경고만 하고 계속 진행 (중복 체크 없이 모든 영상 처리)
          }
        }

        // 5. 등록되지 않은 영상만 필터링
        const unregisteredVideos: Array<{
          videoId: string;
          link: string;
          title: string;
          snippet?: string;
          channelName: string;
          publishedAt: string;
          thumbnail?: string;
        }> = [];

        for (const item of playlistItemsResponse.items) {
          const videoId = item.contentDetails.videoId;
          const link = `https://www.youtube.com/watch?v=${videoId}`;

          if (registeredLinks.has(link)) {
            console.log(`  - [스킵] ${item.snippet.title} (이미 등록됨)`);
            continue;
          }

          unregisteredVideos.push({
            videoId,
            link,
            title: item.snippet.title,
            snippet: item.snippet.description,
            channelName: item.snippet.channelTitle,
            publishedAt: item.contentDetails.videoPublishedAt,
            thumbnail: item.snippet.thumbnails.high?.url,
          });
        }

        console.log(
          `${handle}: 등록되지 않은 영상 ${unregisteredVideos.length}개 발견`,
        );

        for (const video of unregisteredVideos) {
          try {
            console.log(`  - 캡션 가져오는 중: ${video.title}`);
            const captionResult = await this.getVideoCaption(video.videoId);

            // 캡션을 성공적으로 가져온 경우 GPT로 정리된 글 생성
            if (captionResult) {
              const { caption, language } = captionResult;
              console.log(
                `  - GPT로 ${
                  language === 'ko' ? '한국어' : '영어'
                } 콘텐츠 생성 중: ${video.title}`,
              );
              const generatedContent = await this.generateContentFromCaption(
                video.title,
                video.channelName,
                caption,
                language,
              );

              if (generatedContent && generatedContent.content) {
                // 원본 언어로 콘텐츠 저장
                await createYoutube({
                  link: video.link,
                  channelName: video.channelName,
                  channelId: channelId,
                  title: generatedContent.title || video.title,
                  snippet: video.snippet,
                  publishedAt: video.publishedAt,
                  content: generatedContent.content,
                  thumbnail: video.thumbnail,
                  summary: generatedContent.shortSummary,
                });
                console.log(
                  `  - ${
                    language === 'ko' ? '한국어' : '영어'
                  } 콘텐츠 저장 완료: ${video.title}`,
                );

                // 반대 언어로 번역하여 저장
                const targetLanguage = language === 'ko' ? 'en' : 'ko';
                console.log(
                  `  - ${
                    targetLanguage === 'ko' ? '한국어' : '영어'
                  }로 번역 중: ${video.title}`,
                );
                const translatedContent = await this.translateContent(
                  generatedContent.title,
                  generatedContent.content,
                  generatedContent.shortSummary,
                  language,
                  targetLanguage,
                );

                if (translatedContent && translatedContent.content) {
                  await createYoutube({
                    link: video.link,
                    channelName: video.channelName,
                    channelId: channelId,
                    title: translatedContent.title || video.title,
                    snippet: video.snippet,
                    publishedAt: video.publishedAt,
                    content: translatedContent.content,
                    thumbnail: video.thumbnail,
                    summary: translatedContent.shortSummary,
                  });
                  console.log(
                    `  - ${
                      targetLanguage === 'ko' ? '한국어' : '영어'
                    } 번역 콘텐츠 저장 완료: ${video.title}`,
                  );
                } else {
                  console.warn(
                    `  - 번역 실패 (${targetLanguage}): ${video.title}`,
                  );
                }
              }
            }
          } catch (error) {
            console.error(`캡션/콘텐츠 처리 실패 (${video.title}):`, error);
            await GlobalErrorHandler.handleError(
              error as Error,
              'Web3ScanService.processVideo',
              { videoId: video.videoId, handle },
            );
          }
        }
      } catch (error) {
        await GlobalErrorHandler.handleError(
          error as Error,
          'Web3ScanService',
          { handle },
        );
      }
    }
  }
}
