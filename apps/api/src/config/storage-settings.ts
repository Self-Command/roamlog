export interface StorageSettings {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  forcePathStyle: boolean;
  signedUrlTtlSeconds: number;
}
