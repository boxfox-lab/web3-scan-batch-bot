import * as admin from 'firebase-admin';
const firebaseConfig = {
  type: 'service_account',
  project_id: 'bake-c7cac',
  private_key_id: 'ca86d4f89232e7a0d8934ed9b5206912ea2a79be',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDBLJzUtg9j8NQ4\nCkMg1+vzsDn0XR+HBWESEj36avAQ0Lnh4+Aw4KVDM9gA8tVhqfwZXa4B3EZdtgxM\nu3jHdksJXdx9AWGyGolUIA+bF9wzH/KXYq5/9oWlXxVhS10YaXO/h5ZmX62pc1H4\nkpph/mAyJghM4cqDhfAsbIAeHHhLZ7BavLpWoM6zJCgHRsyVq8NhU6b288SCoxV7\nAge8UQlD0HrHJax7/6/qkO2+9seYHx+Yp6kp1Cae6uiynSP4kBv1CrnxcU5uNpU2\nDIFcbg9++aBzit9KeC/XUY90vX0ZiCAvNyIu+L/HVWAxBXexUBD2GfMVntG3N3e2\nXUpw6/R5AgMBAAECggEAA0Ds8U48YHViywDX6ZqJawTUV7p7zfU4EdWvJ+PGNa+g\n+d4x3VDjUl2crUNpzFJ7IF2Uu+D0aclSWAvY+G8UdiIXv8lBVn5zmAWkOFCvZkhg\nTc7H2/g7KbJkyfXlfwRDrVMAzv+cjVvtDQVBxsBslAZSTHffG9ZVLxeyvrnBsu9o\nGBIKBInT1UISHGPYzkV8dDyesJDCEZXux/INN3Gxk8IfAZ3hHSwsk6DR4T7wr0Xk\nTHCE+EYeJYxdESadqXJPDdlPPveXArDp5O85tFG+GVldwM9sigVoQw6TokreSfb/\nKrmkbdSgvFRMWkLyaPAbmkDiA0MkFJa8rR9iBXwN+wKBgQD/CtnuFq7H/sTUW9H0\nQlJkEXyNH0qJEZgGnqLcy1Z31iafA6nW+3m3aZ7Jd+7roUWH4fkRD2zUcqqLhjtg\nMfyMsg2kpiLdjParSOC6s9KVRzFDH2JQLoRV4PGLTq0tr7EzinUcHauokOoB157Z\nVAKwOGP4YlTbk+JPblazsh86swKBgQDB5ksQTNBtgI+Ox5Eryfw+QBdcDQ2fPd21\nyyHxMchGfbJ+ehucg+WKdx0Blx+H9cniAWbzwlTTFNNCCRZ5HzcGFWjThQPYcaMK\nFRxSOZGtrsPlTvAVP5prbDBQBD3dCenVej64xHvsR2FalgRSjbsHDygPdkwV0amD\nsKVrhexaIwKBgQCKC8SUA4ENTZAaZazJ6lAQTAq/lA1TDcvc4WbD3efqq2ZyMZhv\nfeSO60OAR0NyFPO+rgiTPGcqwvoe1UQ0ODo7qXCLC0XZ55/obGT/ia/VDxjR/R3I\nyrTkiwIS5j4EeZGPlUT4N/MfJXkUEDKx7bAa1BsAabEGvRAE8HNLhoEy0wKBgQC2\nnks8QtxbBaYvd04Gy+nCR2K406JsxDu4KGUDYTubCG/AJwkyVBcwXhb3lHmh95/4\nOBHaqsBxPT/rBdwgn4GXPTrJXJHOnNhNeqx91LKbvenKYppDqO+rFO47roMFV3zg\nDo5cPtHoKyJJytivV8U6VNAKIARw2FKrMQfbSPrduQKBgQDpRADbCc6bgdkxoE9h\nsKJ7xsz4Ly2NTp/Y9j0cRGxkvymBAciWOFglTJj9+TVFxMk/oJFSz+13ZjJL54GU\ntqLgSln1DpUKCncro3Spaihzp2OD6VDqSFSmixjYIoZuitTBrGY8tnVqOXAk8RnS\nwDm5ZY9PjQ7lN6Plr1afVMRQHA==\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-7e2f3@bake-c7cac.iam.gserviceaccount.com',
  client_id: '104034323105939653345',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url:
    'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-7e2f3%40bake-c7cac.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
};
export function initFirebase() {
  admin.initializeApp({
    credential: admin.credential.cert({
      clientEmail: firebaseConfig.client_email,
      privateKey: firebaseConfig.private_key,
      projectId: firebaseConfig.project_id,
    }),
  });
}
