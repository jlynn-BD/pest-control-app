import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "pestapp.accessToken";
const REFRESH_TOKEN_KEY = "pestapp.refreshToken";
const USER_KEY = "pestapp.user";

// expo-secure-store has no web implementation. Fall back to localStorage
// there (fine for the `expo start --web` smoke-test target; the real
// field app runs native via Expo Go / a device build, where SecureStore
// is used).
const webStorage = {
  async getItem(key: string): Promise<string | null> {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  },
};

const backend = Platform.OS === "web" ? webStorage : { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync };

export const tokenStore = {
  async getAccessToken(): Promise<string | null> {
    return backend.getItem(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return backend.getItem(REFRESH_TOKEN_KEY);
  },
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await backend.setItem(ACCESS_TOKEN_KEY, accessToken);
    await backend.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  // The signed-in user's profile, kept so the app can open with no signal
  // instead of needing the server to confirm who's logged in first.
  async getUser<T>(): Promise<T | null> {
    const raw = await backend.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async setUser(user: unknown): Promise<void> {
    await backend.setItem(USER_KEY, JSON.stringify(user));
  },
  async clear(): Promise<void> {
    await backend.removeItem(ACCESS_TOKEN_KEY);
    await backend.removeItem(REFRESH_TOKEN_KEY);
    await backend.removeItem(USER_KEY);
  },
};
