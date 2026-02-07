import axios from "axios";

export const carrotRequester = axios.create({
  baseURL: "https://0fhouvnb0j.execute-api.us-east-1.amazonaws.com/live",
});
