import axios from 'axios';

export const web3ScanRequester = axios.create({
  baseURL: 'https://api.compounding.co.kr/web3-scan',
});
