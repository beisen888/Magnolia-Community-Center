// Minimal Web Push sender (VAPID + aes128gcm, RFC 8291/8292) using only Node's built-in crypto.
// Files starting with "_" in /api are helpers, not web endpoints.
const crypto = require("crypto");

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

// publicKey: base64url of the 65-byte uncompressed P-256 point; privateKey: base64url of the 32-byte secret
function vapidKey(publicKey, privateKey) {
  const pub = unb64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key looks wrong");
  return crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: b64u(unb64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
}

function vapidHeader(endpoint, publicKey, key, subject) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${publicKey}`;
}

// encrypts one payload for one subscription (aes128gcm, single record)
function encrypt(payload, p256dh, authSecret) {
  const uaPub = unb64u(p256dh), auth = unb64u(authSecret);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

// sub: { endpoint, p256dh, auth }. Returns { ok, status, gone } — gone = subscription expired, delete it.
async function sendPush(sub, data, vapid) {
  const body = encrypt(JSON.stringify(data), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: vapidHeader(sub.endpoint, vapid.publicKey, vapid.key, vapid.subject), "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
    body,
  });
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
}

module.exports = { sendPush, vapidKey, encrypt, b64u, unb64u };
