export function deterministicIconBase64(seed, salt) {
  let state = (Math.imul(seed + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes.toString("base64");
}
