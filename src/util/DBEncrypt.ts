import * as crypto from 'crypto';
import { DATABASE_ENCRYPT_KEY } from '../config/env';
import {
  EncryptedColumn,
  EncryptedColumnOptions,
  EncryptionOptions,
} from 'typeorm-encrypted-column';

export namespace DBEncrypt {
  const encryptOption: EncryptionOptions = {
    key: DATABASE_ENCRYPT_KEY,
    algorithm: 'aes-256-cbc',
    ivLength: 16,
    looseMatching: false,
  };
  export const Column = (options?: Omit<EncryptedColumnOptions, 'encrypt'>) =>
    EncryptedColumn({
      ...options,
      encrypt: encryptOption,
    });

  export const encrypt = (data: string) => encryptString(data, encryptOption);
  export const decrypt = (data: string) => decryptString(data, encryptOption);

  const encryptString = (
    string: string,
    options: { ivLength: number; key: string; algorithm: string },
  ) => {
    const buffer = Buffer.from(string, 'utf8');
    const iv = crypto.randomBytes(options.ivLength);
    const key = Buffer.from(options.key, 'hex');
    const cipher = crypto.createCipheriv(options.algorithm, key, iv);
    const start = cipher.update(buffer);
    const end = cipher.final();
    return Buffer.concat([iv, start, end]).toString('base64');
  };

  const decryptString = (
    string: string,
    options: { ivLength: number; key: string; algorithm: string },
  ) => {
    const buffer = Buffer.from(string, 'base64');
    const iv = buffer.slice(0, options.ivLength);
    const key = Buffer.from(options.key, 'hex');
    const decipher = crypto.createDecipheriv(options.algorithm, key, iv);
    const start = decipher.update(buffer.slice(options.ivLength));
    const end = decipher.final();
    return Buffer.concat([start, end]).toString('utf8');
  };

  export function sha256(message: string) {
    return crypto.createHash('sha256').update(message).digest('base64');
  }
}
