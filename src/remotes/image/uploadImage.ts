import { carrotRequester } from './carrotRequester';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function uploadImage(uri: string) {
  // base64 이미지 데이터를 처리
  const base64Data = uri.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // 임시 파일 생성
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(
    tempDir,
    `${Math.floor(Math.random() * 100000000)}.jpg`,
  );

  try {
    // 버퍼를 파일로 저장
    fs.writeFileSync(tempFilePath, buffer as unknown as Uint8Array);

    // FormData 생성
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath), {
      filename: path.basename(tempFilePath),
      contentType: 'image/jpeg',
    });

    const res = await carrotRequester.post<string>('/image/upload', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    return res.data;
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    // 임시 파일 삭제
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
