import axios from "axios";

import dataJSON from '../utils/data.json'

const baseURLEnv = process.env.REACT_APP_AMP_SERVER;

export const api = axios.create({
  baseURL: baseURLEnv,
});

export const getEvalData = async (content, currentURL) => {
  if (process.env.REACT_APP_API_DATA_SOURCE === "local") {
    return await getEvalDataByLocal(content, currentURL);
  }
  return await getEvalDataByAPI(content, currentURL);
}

// TODO: SRP , cannot receive argument that can be a URL or HTML content
const getEvalDataByAPI = async (content, currentURLorHTML) => {
  let response;
  if (content === "html") {
    response = await api.post(`/eval/html`, { html: currentURLorHTML });
  } else {
    const encodedURL = encondeBase64Url(currentURLorHTML);
    response = await api.get(`/eval/${encodeURIComponent(encodedURL)}`);
  }

  // Normalize response structure so frontend always receives { data: { success: 1, result: { pagecode, data: { tot } } } }
  if (response && response.data) {
    if (response.data.data && !response.data.result) {
      const payload = response.data.data;
      return {
        ...response,
        data: {
          success: 1,
          message: "NO_ERROR",
          errors: null,
          result: {
            pagecode: payload.pagecode,
            data: {
              tot: payload.tot || payload.data?.tot
            }
          }
        }
      };
    }
  }

  return response;
}

function encondeBase64Url(url) {
  return btoa(url);
}

const getEvalDataByLocal = async (content, currentURL) => {
  const response = dataJSON
  return response;
}
