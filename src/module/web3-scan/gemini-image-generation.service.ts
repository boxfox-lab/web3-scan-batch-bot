import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { uploadImage } from '../../remotes/image';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';

export interface GenerateImageOptions {
  topic: string;
  contentSummary: string;
  lang?: 'ko' | 'en'; // 언어 (기본값: 'ko')
  saveResponseJson?: boolean;
}

export class GeminiImageGenerationService {
  private genAI: GoogleGenerativeAI;
  private openai: OpenAI;

  constructor(apiKey?: string, openai?: OpenAI) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    this.genAI = new GoogleGenerativeAI(key);
    this.openai = openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * Gemini를 사용하여 이미지를 생성하고 업로드합니다.
   * @param options 이미지 생성 옵션
   * @returns 업로드된 이미지 URL 또는 null (실패 시)
   */
  async generateAndUploadImage(
    options: GenerateImageOptions,
  ): Promise<string | null> {
    const { topic, contentSummary, lang = 'ko' } = options;

    try {
      console.log(`[GeminiImageGeneration] 이미지 생성 시작: ${topic} (${lang})`);

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-image',
      });

      // AI를 사용하여 리포트 내용을 분석하고 적절한 이미지 프롬프트 생성
      const prompt = await this.buildPromptWithAI(topic, contentSummary, lang);

      const result = await model.generateContent(prompt);

      // 이미지 데이터 추출 (Base64 형태) - parts 배열에서 inlineData 찾기
      const parts = result.response.candidates?.[0]?.content?.parts || [];
      let artifacts = null;
      for (const part of parts) {
        if (part.inlineData) {
          artifacts = part.inlineData;
          break;
        }
      }

      if (!artifacts || !artifacts.data) {
        console.error('[GeminiImageGeneration] 이미지 데이터를 찾을 수 없습니다.');
        return null;
      }

      // Base64 데이터 추출
      const base64Data = artifacts.data;

      // 이미지 업로드
      const imageUrl = await uploadImage(base64Data);

      console.log(`[GeminiImageGeneration] 이미지 생성 및 업로드 완료: ${imageUrl}`);
      return imageUrl;
    } catch (error) {
      console.error('[GeminiImageGeneration] 이미지 생성/업로드 실패:', error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'GeminiImageGenerationService.generateAndUploadImage',
        { topic },
      );
      return null;
    }
  }

  /**
   * AI를 사용하여 리포트 내용을 분석하고 적절한 이미지 프롬프트를 생성합니다.
   */
  private async buildPromptWithAI(
    topic: string,
    contentSummary: string,
    lang: 'ko' | 'en' = 'ko',
  ): Promise<string> {
    try {
      const systemPrompt =
        lang === 'en'
          ? `You are an expert in analyzing blog content and generating appropriate image prompts.
Read the given blog post title and content, and create a prompt for generating an image that accurately reflects the content.

Prompt Creation Guidelines:
1. Accurately analyze the actual content and topic of the blog post
2. Identify the core concepts, technologies, and topics covered in the article
3. Suggest specific images that match the actual content of the article, not generic cryptocurrency imagery
4. Suggest professional, trustworthy editorial-style images
5. Do not include text, numbers, chart values, etc.

Prompt Format:
- Image Theme: Image theme representing the core topic of the article
- Visual Context: Specific context or concept the image should express
- Visual Elements: Visual elements that should be included in the image

Absolutely Prohibited:
- Cliché expressions like "moon", "rocket", "to the moon"
- Exaggerated visual elements like price charts, surge arrows
- Text overlays, numbers, chart values
- Generic cryptocurrency imagery (moon, rocket, etc.)`
          : `당신은 블로그 글의 내용을 분석하여 적절한 이미지 프롬프트를 생성하는 전문가입니다.
주어진 블로그 글의 제목과 내용을 읽고, 그 내용을 정확히 반영하는 이미지를 생성하기 위한 프롬프트를 작성해주세요.

프롬프트 작성 가이드:
1. 블로그 글의 실제 내용과 주제를 정확히 분석하세요
2. 글에서 다루는 핵심 개념, 기술, 주제를 파악하세요
3. 일반적인 암호화폐 이미지가 아닌, 글의 실제 내용에 맞는 구체적인 이미지를 제안하세요
4. 전문적이고 신뢰할 수 있는 에디토리얼 스타일의 이미지를 제안하세요
5. 텍스트, 숫자, 차트 값 등은 포함하지 마세요

프롬프트 형식:
- Image Theme: 글의 핵심 주제를 나타내는 이미지 테마
- Visual Context: 이미지가 표현해야 할 구체적인 컨텍스트나 개념
- Visual Elements: 이미지에 포함되어야 할 시각적 요소들

절대 금지:
- "떡상", "급등", "신고가" 같은 클리셰 표현
- 가격 상승 차트, 급등 화살표 등 과장된 시각 요소
- 텍스트 오버레이, 숫자, 차트 값
- 일반적인 암호화폐 이미지 (moon, rocket 등)`;

      const userPrompt =
        lang === 'en'
          ? `Analyze the following blog post content and generate an appropriate image prompt:

Title: ${topic}
Content: ${contentSummary.substring(0, 2000)}

Please create a professional image prompt that accurately reflects the content of the article above.`
          : `다음 블로그 글의 내용을 분석하여 적절한 이미지 프롬프트를 생성해주세요:

제목: ${topic}
내용: ${contentSummary.substring(0, 2000)}

위 글의 내용을 정확히 반영하는 전문적인 이미지 프롬프트를 작성해주세요.`;

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
            name: 'generate_image_prompt',
            description:
              '블로그 글 내용을 분석하여 적절한 이미지 생성 프롬프트를 생성합니다.',
            parameters: {
              type: 'object',
              properties: {
                imageTheme: {
                  type: 'string',
                  description:
                    '이미지 테마 (글의 핵심 주제를 나타내는 테마, 예: "digital asset tokenization", "privacy technology", "blockchain infrastructure" 등)',
                },
                visualContext: {
                  type: 'string',
                  description:
                    '시각적 컨텍스트 (이미지가 표현해야 할 구체적인 개념이나 맥락)',
                },
                visualElements: {
                  type: 'string',
                  description:
                    '시각적 요소 (이미지에 포함되어야 할 구체적인 시각적 요소들, 쉼표로 구분)',
                },
              },
              required: ['imageTheme', 'visualContext', 'visualElements'],
            },
          },
        ],
        function_call: { name: 'generate_image_prompt' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'generate_image_prompt') {
        console.warn(
          '[GeminiImageGeneration] AI 프롬프트 생성 실패, 기본 프롬프트 사용',
        );
        return this.buildDefaultPrompt(topic, contentSummary, lang);
      }

      const args = JSON.parse(functionCall.arguments || '{}');
      const imageTheme = args.imageTheme || 'blockchain technology';
      const visualContext = args.visualContext || '';
      const visualElements = args.visualElements || '';

      return this.buildFinalPrompt(
        topic,
        contentSummary,
        imageTheme,
        visualContext,
        visualElements,
        lang,
      );
    } catch (error) {
      console.error(
        '[GeminiImageGeneration] AI 프롬프트 생성 중 오류 발생, 기본 프롬프트 사용:',
        error,
      );
      return this.buildDefaultPrompt(topic, contentSummary, lang);
    }
  }

  /**
   * 기본 프롬프트 생성 (AI 분석 실패 시 사용)
   */
  private buildDefaultPrompt(
    topic: string,
    contentSummary: string,
    lang: 'ko' | 'en' = 'ko',
  ): string {
    const contentForAnalysis = contentSummary.substring(0, 1000);
    return this.buildFinalPrompt(
      topic,
      contentSummary,
      'blockchain and cryptocurrency technology',
      'The image should represent modern blockchain technology and digital innovation in finance',
      'modern blockchain technology, digital innovation, financial technology, professional tech setting',
      lang,
    );
  }

  /**
   * 최종 이미지 생성 프롬프트를 생성합니다.
   */
  private buildFinalPrompt(
    topic: string,
    contentSummary: string,
    imageTheme: string,
    visualContext: string,
    visualElements: string,
    lang: 'ko' | 'en' = 'ko',
  ): string {
    const contentForAnalysis = contentSummary.substring(0, 1000);

    return `Create a professional, high-quality blog article image that accurately and visually represents the following article content:

Article Topic: ${topic}
Article Content Summary: ${contentForAnalysis}

Based on the article topic and content above, determine the most appropriate visual representation.

Image Theme: ${imageTheme}
Visual Context: ${visualContext}
Visual Elements to Include: ${visualElements}

Requirements:
- The image MUST accurately reflect the actual content and topic of the article
- Professional, editorial-style image suitable for a financial/technology blog article
- Photorealistic style, high resolution (4K quality)
- Clean, modern, and sophisticated design
- Professional business or technology setting that matches the article's actual theme and content
- Use appropriate visual metaphors and symbols that directly relate to what the article discusses
- The image should help readers understand the article's main concept or theme
- Balanced composition with good visual hierarchy
- Professional color palette (blues, grays, whites, with subtle accent colors)
- Serious, informative, and trustworthy atmosphere
- NO text overlays, numbers, charts with specific values, or price indicators
- NO Korean text, English text, or any written characters in the image
- NO cliché cryptocurrency imagery like "moon", "rocket", "to the moon", or exaggerated price charts
- NO generic "떡상", "급등", "신고가" imagery
- Focus on representing the actual concept, technology, or theme discussed in the article
- Professional photography or illustration style, suitable for a serious financial/technology publication

Style Guidelines:
- Editorial photography style (like The Economist, Financial Times, or TechCrunch)
- Clean and minimal design
- Professional and trustworthy appearance
- Concept-driven rather than emotion-driven
- Avoid sensational or dramatic imagery
- The image should be directly relevant to the article's content and help illustrate the main points
- Focus on the underlying technology, infrastructure, concept, or theme that the article actually discusses

Important: Analyze the article content carefully and create an image that truly represents what the article is about, not generic cryptocurrency imagery.`;
  }

  /**
   * 주제와 내용 요약을 바탕으로 이미지 생성 프롬프트를 생성합니다.
   * 리포트의 실제 내용과 주제를 정확히 반영하여 적절한 이미지를 생성합니다.
   * @deprecated AI 기반 프롬프트 생성을 위해 buildPromptWithAI를 사용하세요
   */
  private buildPrompt(topic: string, contentSummary: string): string {
    // 리포트 내용을 더 많이 분석 (1000자까지)
    const fullContent = contentSummary.toLowerCase();
    const contentForAnalysis = contentSummary.substring(0, 1000);
    
    // 주제(topic)도 분석에 포함
    const topicLower = topic.toLowerCase();
    const combinedText = `${topicLower} ${fullContent}`;
    
    let imageTheme = 'blockchain technology';
    let visualElements = '';
    let specificContext = '';

    // 주제와 내용을 종합적으로 분석하여 이미지 테마 결정
    if (
      combinedText.includes('토큰화') ||
      combinedText.includes('tokenization') ||
      combinedText.includes('rwa') ||
      combinedText.includes('실물자산')
    ) {
      imageTheme = 'digital asset tokenization and blockchain infrastructure';
      visualElements = 'modern blockchain network, digital tokens, financial technology infrastructure, professional business setting';
      specificContext = 'The image should represent the concept of tokenizing real-world assets and digital transformation of traditional finance';
    } else if (
      combinedText.includes('프라이버시') ||
      combinedText.includes('privacy') ||
      combinedText.includes('익명') ||
      combinedText.includes('보안')
    ) {
      imageTheme = 'privacy and security technology';
      visualElements = 'encryption concepts, secure digital networks, privacy protection, technology security';
      specificContext = 'The image should represent privacy protection, encryption technology, and secure digital networks';
    } else if (
      combinedText.includes('pow') ||
      combinedText.includes('작업증명') ||
      combinedText.includes('mining') ||
      combinedText.includes('마이닝')
    ) {
      imageTheme = 'blockchain mining and proof of work';
      visualElements = 'mining infrastructure, energy and computation, blockchain network nodes, industrial technology';
      specificContext = 'The image should represent blockchain mining infrastructure, computational power, and proof of work consensus';
    } else if (
      combinedText.includes('인프라') ||
      combinedText.includes('infrastructure') ||
      combinedText.includes('레이어') ||
      combinedText.includes('layer')
    ) {
      imageTheme = 'blockchain infrastructure and network technology';
      visualElements = 'network infrastructure, connected nodes, digital architecture, technology systems';
      specificContext = 'The image should represent blockchain network infrastructure, connected nodes, and digital architecture';
    } else if (
      combinedText.includes('etf') ||
      combinedText.includes('유동성') ||
      combinedText.includes('liquidity') ||
      combinedText.includes('자금')
    ) {
      imageTheme = 'financial markets and investment';
      visualElements = 'professional financial analysis, market data visualization, investment concepts, modern finance';
      specificContext = 'The image should represent financial markets, investment analysis, and professional finance concepts';
    } else if (
      combinedText.includes('정책') ||
      combinedText.includes('policy') ||
      combinedText.includes('규제') ||
      combinedText.includes('regulation')
    ) {
      imageTheme = 'policy and regulation in digital finance';
      visualElements = 'professional business meeting, policy documents, regulatory framework, corporate setting';
      specificContext = 'The image should represent policy discussions, regulatory frameworks, and professional business settings';
    } else if (
      combinedText.includes('ai') ||
      combinedText.includes('인공지능') ||
      combinedText.includes('artificial intelligence')
    ) {
      imageTheme = 'artificial intelligence and blockchain convergence';
      visualElements = 'AI technology, digital innovation, futuristic technology, smart systems';
      specificContext = 'The image should represent the convergence of AI and blockchain technology, digital innovation';
    } else if (
      combinedText.includes('시장') ||
      combinedText.includes('market') ||
      combinedText.includes('분석') ||
      combinedText.includes('analysis') ||
      combinedText.includes('브리핑')
    ) {
      imageTheme = 'market analysis and financial data';
      visualElements = 'data visualization, market charts, financial analysis, professional analytics';
      specificContext = 'The image should represent market analysis, data visualization, and professional financial analytics';
    } else {
      // 기본: 블록체인 기술 일반
      imageTheme = 'blockchain and cryptocurrency technology';
      visualElements = 'modern blockchain technology, digital innovation, financial technology, professional tech setting';
      specificContext = 'The image should represent modern blockchain technology and digital innovation in finance';
    }

    return `Create a professional, high-quality blog article image that accurately and visually represents the following article content:

Article Topic: ${topic}
Article Content Summary: ${contentForAnalysis}

Based on the article topic and content above, determine the most appropriate visual representation.

Image Theme: ${imageTheme}
Visual Context: ${specificContext}
Visual Elements to Include: ${visualElements}

Requirements:
- The image MUST accurately reflect the actual content and topic of the article
- Professional, editorial-style image suitable for a financial/technology blog article
- Photorealistic style, high resolution (4K quality)
- Clean, modern, and sophisticated design
- Professional business or technology setting that matches the article's actual theme and content
- Use appropriate visual metaphors and symbols that directly relate to what the article discusses
- The image should help readers understand the article's main concept or theme
- Balanced composition with good visual hierarchy
- Professional color palette (blues, grays, whites, with subtle accent colors)
- Serious, informative, and trustworthy atmosphere
- NO text overlays, numbers, charts with specific values, or price indicators
- NO Korean text, English text, or any written characters in the image
- NO cliché cryptocurrency imagery like "moon", "rocket", "to the moon", or exaggerated price charts
- NO generic "떡상", "급등", "신고가" imagery
- Focus on representing the actual concept, technology, or theme discussed in the article
- Professional photography or illustration style, suitable for a serious financial/technology publication

Style Guidelines:
- Editorial photography style (like The Economist, Financial Times, or TechCrunch)
- Clean and minimal design
- Professional and trustworthy appearance
- Concept-driven rather than emotion-driven
- Avoid sensational or dramatic imagery
- The image should be directly relevant to the article's content and help illustrate the main points
- Focus on the underlying technology, infrastructure, concept, or theme that the article actually discusses

Important: Analyze the article content carefully and create an image that truly represents what the article is about, not generic cryptocurrency imagery.`;
  }
}

