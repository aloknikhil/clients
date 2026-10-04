import { fromB64Url, parseCredentialId, sameBytes, sanitizeRequest, toB64Url } from "./webauthn";

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const encoded = toB64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(fromB64Url(encoded))).toEqual(Array.from(bytes));
  });
});

describe("parseCredentialId", () => {
  it("parses Bitwarden GUID credential ids to 16 raw bytes", () => {
    const raw = parseCredentialId("d548826e-79b4-db40-a3d8-11116f7e8349");
    expect(Array.from(raw!)).toEqual([
      0xd5, 0x48, 0x82, 0x6e, 0x79, 0xb4, 0xdb, 0x40, 0xa3, 0xd8, 0x11, 0x11, 0x6f, 0x7e, 0x83,
      0x49,
    ]);
  });

  it("parses imported b64.-prefixed ids", () => {
    expect(Array.from(parseCredentialId("b64.AQID")!)).toEqual([1, 2, 3]);
  });

  it("rejects anything else", () => {
    expect(parseCredentialId("not-a-guid")).toBeUndefined();
  });

  it("compares bytes exactly", () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("sanitizeRequest (page-controlled input)", () => {
  const get = {
    kind: "get",
    challenge: "AAAA",
    allowCredentials: [],
    rpId: "example.com",
    mediation: "conditional",
  };
  const create = {
    kind: "create",
    rp: { id: "example.com", name: "Example" },
    user: { id: "AQID", name: "alice", displayName: "Alice" },
    challenge: "AAAA",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [],
  };

  it("accepts well-formed requests and drops unknown fields", () => {
    expect(sanitizeRequest({ ...get, evil: "x" })).toEqual({
      kind: "get",
      rpId: "example.com",
      challenge: "AAAA",
      allowCredentials: [],
      userVerification: undefined,
      mediation: "conditional",
      timeout: undefined,
    });
    expect(sanitizeRequest(create)?.kind).toBe("create");
  });

  it.each([
    ["non-object", 42],
    ["unknown kind", { ...get, kind: "sign" }],
    ["non-base64url challenge", { ...get, challenge: "a+b/c=" }],
    ["numeric challenge", { ...get, challenge: 42 }],
    ["oversized allow list", { ...get, allowCredentials: Array(65).fill("AA") }],
    ["non-string rpId", { ...get, rpId: { host: "x" } }],
    ["create without user", { ...create, user: undefined }],
    [
      "create with string alg",
      { ...create, pubKeyCredParams: [{ type: "public-key", alg: "-7" }] },
    ],
  ])("rejects %s", (_, input) => {
    expect(sanitizeRequest(input)).toBeUndefined();
  });
});
