import { gunzipSync } from "node:zlib";
import { untar, type MarketPort } from "@mapward/abstract-server";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Текст UTF-8 или `undefined`: двоичный файл в копию не едет. */
export const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
};

async function get(url: string): Promise<Uint8Array | undefined> {
  const response = await fetch(url, { headers: { "user-agent": "mapward" } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Сеть маркетплейса для node: публичный GitHub без токена — индекс прямой ссылкой, репозиторий
 * архивом ветки. gzip и текст — здесь, tar разбирает сервер.
 */
export const marketPort: MarketPort = {
  text: async (url) => {
    const bytes = await get(url);
    return bytes && decodeUtf8(bytes);
  },
  archive: async (url) => {
    const bytes = await get(url);
    return bytes && untar(new Uint8Array(gunzipSync(bytes)), decodeUtf8);
  },
};
