import axios from "axios";
import { setupMock } from "./mockApi";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://api.never777skipyourwork25.qpon/api/v1";

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.request.use(
  (config) => {
    const tempToken = localStorage.getItem('tempAuthToken');
    const authToken = localStorage.getItem('token');

    const token = tempToken || authToken;

    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      console.log("Authentication error detected");

      const isVerifying2FA = error.config.url.includes('verify-2fa');
      // The AI gateway routes (mockApi.js passes only these three through to
      // the REAL backend — see the `mock.onAny(/\/ai\/.../).passThrough()`
      // entry there) require a real backend JWT that the mock login's fake
      // session token was never going to satisfy. A 401 here means only
      // "the live AI features aren't reachable right now" — it must never
      // be treated as "the user's whole session expired," or every visit to
      // an AI page silently logs the entire app out and, on the next
      // getUserData() call, randomizes the user into a completely different
      // fake identity/role (see mockApi.js's `/user/me` handler).
      const isAiGateway = /\/ai\/(providers|narrative|explore)$/.test(error.config.url);

      if (!isVerifying2FA && !isAiGateway) {
        localStorage.removeItem('token');
        localStorage.removeItem('data');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('role');
      }
    }

    return Promise.reject(error);
  }
);

if (import.meta.env.VITE_USE_MOCK_API !== "false") {
  setupMock(axiosInstance);
}

export default axiosInstance;
