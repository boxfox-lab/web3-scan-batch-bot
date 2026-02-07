import { carrotRequester } from "./carrotRequester";
import FormData from "form-data";

export async function uploadFile({
  uri,
  type,
  name,
}: {
  uri: string;
  type: string;
  name: string;
}) {
  const formData = new FormData();
  formData.append("file", {
    uri,
    name,
    type,
  } as any);

  const res = await carrotRequester
    .post<string>("/image/upload", formData)
    .catch((e) => {
      console.error(e);
      throw e;
    });
  return res.data;
}

/**
 * Node.js 환경에서 Buffer를 받아 이미지를 업로드합니다.
 * OpenAI DALL-E에서 생성한 base64 이미지를 업로드할 때 사용합니다.
 */
export async function uploadImageFile(buffer: Buffer, filename?: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", buffer, {
    filename: filename || `image-${Date.now()}.png`,
    contentType: "image/png",
  });

  const res = await carrotRequester.post<string>("/image/upload", formData, {
    headers: {
      ...formData.getHeaders(),
    },
  });

  return res.data;
}
