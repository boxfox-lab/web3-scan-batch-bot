import { web3ScanRequester } from '../youtube';

export interface CreateBlogDto {
  title: string;
  content: string;
  author?: string;
  lang?: string;
  thumbnail?: string;
}

export interface BlogEntity {
  id: number;
  title: string;
  content: string;
  author?: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createBlog(
  createBlogDto: CreateBlogDto,
): Promise<BlogEntity> {
  const response = await web3ScanRequester.post<BlogEntity>(
    '/blogs',
    createBlogDto,
    {
      headers: {
        'X-API-KEY': process.env.WEB3_SCAN_API_KEY,
      },
    },
  );
  return response.data;
}
