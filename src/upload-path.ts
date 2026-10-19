// file.upload reads from the server's disk, so a prompt-injected agent could otherwise upload ~/.ssh or .env to Discord.
// Local uploads are off unless DISCORD_MCP_UPLOAD_DIR is set, and then only files inside that directory are allowed.
import fs from 'node:fs';
import path from 'node:path';

export const UPLOAD_DIR_ENV = 'DISCORD_MCP_UPLOAD_DIR';

/**
 * Returns the path to hand to discord.js. http(s) URLs pass through unchanged; local paths
 * (relative ones resolve against the upload directory) must resolve, after symlinks, to a file inside it.
 */
export function resolveUploadPath(filePath: string, uploadDir: string | undefined): string {
  if (/^https?:\/\//i.test(filePath)) return filePath;

  if (!uploadDir) {
    throw new Error(`Uploading local files is disabled. Set ${UPLOAD_DIR_ENV} to a directory to allow uploads from it.`);
  }

  const root = fs.realpathSync(path.resolve(uploadDir));
  let target: string;
  try {
    target = fs.realpathSync(path.resolve(root, filePath));
  } catch {
    throw new Error(`File not found in ${UPLOAD_DIR_ENV}: ${filePath}`);
  }

  const relative = path.relative(root, target);
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (relative === '' || escapes) {
    throw new Error(`File is outside ${UPLOAD_DIR_ENV}: ${filePath}`);
  }
  if (!fs.statSync(target).isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  return target;
}
