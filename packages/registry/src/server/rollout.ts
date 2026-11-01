import crypto from 'node:crypto';

/** Which side of a rollout a client lands on. The same client always gets the same answer. */
export function inRollout(
  clientId: string,
  remote: string,
  rolloutId: string,
  percent: number,
): boolean {
  const digest = crypto
    .createHash('sha256')
    .update(`${clientId}\0${remote}\0${rolloutId}`)
    .digest();
  return digest.readUInt32BE(0) % 100 < percent;
}
