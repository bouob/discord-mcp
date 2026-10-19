import { DiscordAPIError, REST, RequestMethod } from '@discordjs/rest';
import type { DiscordRequest, DiscordResponse, RestExecutor } from './types.js';

const METHODS: Record<DiscordRequest['method'], RequestMethod> = {
  GET: RequestMethod.Get,
  POST: RequestMethod.Post,
  PUT: RequestMethod.Put,
  PATCH: RequestMethod.Patch,
  DELETE: RequestMethod.Delete,
};

function toSearchParams(query: DiscordRequest['query']): URLSearchParams | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.append(key, String(value));
  return params;
}

async function readBody(res: { status: number; text(): Promise<string> }): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Raw Discord REST call (no policy). The base URL is fixed to API v10 by @discordjs/rest;
 * callers cannot influence the host. Discord API errors resolve as `{status, data}`.
 */
export function createRestExecutor(token: string): RestExecutor {
  const rest = new REST({ version: '10' }).setToken(token);
  return async (req: DiscordRequest): Promise<DiscordResponse> => {
    try {
      const res = await rest.queueRequest({
        fullRoute: req.path as `/${string}`,
        method: METHODS[req.method],
        query: toSearchParams(req.query),
        body: req.body,
        reason: req.reason,
      });
      return { status: res.status, data: await readBody(res) };
    } catch (err) {
      if (err instanceof DiscordAPIError) return { status: err.status, data: err.rawError };
      throw err;
    }
  };
}
