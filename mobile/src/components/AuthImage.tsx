import React, { useEffect, useState } from "react";
import { Image, ImageProps, Platform } from "react-native";
import { API_BASE_URL } from "../api/config";
import { tokenStore } from "../api/tokenStore";

// Images stored on the server (photos, signatures) are behind login, so a
// plain <Image uri> gets a 401 and shows blank. Server URLs are loaded with
// the access token: as a request header on native, and on web (where
// react-native-web's Image ignores headers) by fetching the bytes and
// showing them from a blob URL. Local files and data URLs load as normal.
export function AuthImage({ uri, ...rest }: { uri: string } & Omit<ImageProps, "source">) {
  const isRemote = uri.startsWith(API_BASE_URL);
  const [token, setToken] = useState<string | null>(null);
  const [webSrc, setWebSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(!isRemote);

  useEffect(() => {
    if (!isRemote) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const t = await tokenStore.getAccessToken();
      if (cancelled) return;
      if (Platform.OS === "web") {
        try {
          const res = await fetch(uri, { headers: t ? { Authorization: `Bearer ${t}` } : undefined });
          if (!res.ok) throw new Error(String(res.status));
          objectUrl = URL.createObjectURL(await res.blob());
          if (!cancelled) setWebSrc(objectUrl);
        } catch {
          // leave blank rather than show a broken-image box
        }
      } else {
        setToken(t);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, isRemote]);

  if (isRemote && Platform.OS === "web") return webSrc ? <Image {...rest} source={{ uri: webSrc }} /> : null;
  if (!ready) return null;
  return <Image {...rest} source={{ uri, headers: isRemote && token ? { Authorization: `Bearer ${token}` } : undefined }} />;
}
